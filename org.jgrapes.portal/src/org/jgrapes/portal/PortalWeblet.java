/*
 * JGrapes Event Driven Framework
 * Copyright (C) 2017-2018 Michael N. Lipp
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by 
 * the Free Software Foundation; either version 3 of the License, or 
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful, but 
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License 
 * for more details.
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, see <http://www.gnu.org/licenses/>.
 */

package org.jgrapes.portal;

import freemarker.template.Configuration;
import freemarker.template.SimpleScalar;
import freemarker.template.Template;
import freemarker.template.TemplateException;
import freemarker.template.TemplateExceptionHandler;
import freemarker.template.TemplateMethodModelEx;
import freemarker.template.TemplateModel;
import freemarker.template.TemplateModelException;

import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.PipedReader;
import java.io.PipedWriter;
import java.io.Reader;
import java.io.UnsupportedEncodingException;
import java.io.Writer;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.CharBuffer;
import java.text.Collator;
import java.text.ParseException;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.MissingResourceException;
import java.util.Optional;
import java.util.ResourceBundle;
import java.util.ServiceLoader;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.function.BiFunction;
import java.util.function.Function;
import java.util.stream.StreamSupport;

import javax.json.Json;
import javax.json.JsonObject;
import javax.json.JsonReader;

import org.jdrupes.httpcodec.protocols.http.HttpConstants.HttpStatus;
import org.jdrupes.httpcodec.protocols.http.HttpField;
import org.jdrupes.httpcodec.protocols.http.HttpResponse;
import org.jdrupes.httpcodec.types.Converters;
import org.jdrupes.httpcodec.types.MediaType;
import org.jdrupes.json.JsonDecodeException;
import org.jgrapes.core.Channel;
import org.jgrapes.core.Component;
import org.jgrapes.core.EventPipeline;
import org.jgrapes.core.Manager;
import org.jgrapes.core.annotation.Handler;
import org.jgrapes.http.LanguageSelector.Selection;
import org.jgrapes.http.ResponseCreationSupport;
import org.jgrapes.http.Session;
import org.jgrapes.http.annotation.RequestHandler;
import org.jgrapes.http.events.GetRequest;
import org.jgrapes.http.events.Request;
import org.jgrapes.http.events.Response;
import org.jgrapes.http.events.WebSocketAccepted;
import org.jgrapes.io.IOSubchannel;
import org.jgrapes.io.events.Closed;
import org.jgrapes.io.events.Input;
import org.jgrapes.io.events.Output;
import org.jgrapes.io.util.ByteBufferOutputStream;
import org.jgrapes.io.util.CharBufferWriter;
import org.jgrapes.io.util.LinkedIOSubchannel;
import org.jgrapes.portal.events.JsonInput;
import org.jgrapes.portal.events.PageResourceRequest;
import org.jgrapes.portal.events.PortalCommand;
import org.jgrapes.portal.events.PortalReady;
import org.jgrapes.portal.events.PortletResourceRequest;
import org.jgrapes.portal.events.ResourceRequestCompleted;
import org.jgrapes.portal.events.SetLocale;
import org.jgrapes.portal.events.SetTheme;
import org.jgrapes.portal.events.SimplePortalCommand;
import org.jgrapes.portal.themes.base.Provider;
import org.jgrapes.util.events.KeyValueStoreData;
import org.jgrapes.util.events.KeyValueStoreQuery;
import org.jgrapes.util.events.KeyValueStoreUpdate;

/**
 * Provides resources using {@link Request}/{@link Response}
 * events. Some resource requests (page resource, portlet resource)
 * are forwarded via the {@link Portal} component to the portlets.
 */
public class PortalWeblet extends Component {

	private static final String PORTAL_SESSION_IDS 
		= PortalWeblet.class.getName() + ".portalSessionId";
	
	private Portal portal;
	private ServiceLoader<ThemeProvider> themeLoader;
	private static Configuration fmConfig = null;
	
	static {
		fmConfig = new Configuration(Configuration.VERSION_2_3_26);
		fmConfig.setClassLoaderForTemplateLoading(
				PortalWeblet.class.getClassLoader(), "org/jgrapes/portal");
		fmConfig.setDefaultEncoding("utf-8");
		fmConfig.setTemplateExceptionHandler(
				TemplateExceptionHandler.RETHROW_HANDLER);
        fmConfig.setLogTemplateExceptions(false);
	}
	
	private Function<Locale,ResourceBundle> resourceBundleSupplier;
	private BiFunction<ThemeProvider,String,URL> fallbackResourceSupplier
		= (themeProvider, resource) -> { return null; };
	private Set<Locale> supportedLocales;
	
	private ThemeProvider baseTheme;
	private Map<String,Object> portalBaseModel;
	private RenderSupport renderSupport = new RenderSupportImpl();
	private boolean useMinifiedResources = true;
	private long portalSessionNetworkTimeout = 45000;
	private long portalSessionRefreshInterval = 30000;
	private long portalSessionInactivityTimeout = -1;

	/**
	 * Instantiates a new portal weblet.
	 *
	 * @param webletChannel the weblet channel
	 * @param portal the portal
	 */
	public PortalWeblet(Channel webletChannel, Portal portal) {
		super(webletChannel);
		this.portal = portal;
		baseTheme = new Provider();
		
		supportedLocales = new HashSet<>();
		for (Locale locale: Locale.getAvailableLocales()) {
			if (locale.getLanguage().equals("")) {
				continue;
			}
			if (resourceBundleSupplier != null) {
				ResourceBundle rb = resourceBundleSupplier.apply(locale);
				if (rb.getLocale().equals(locale)) {
					supportedLocales.add(locale);
				}
			}
			ResourceBundle rb = ResourceBundle.getBundle(getClass()
					.getPackage().getName()	+ ".l10n", locale);
			if (rb.getLocale().equals(locale)) {
				supportedLocales.add(locale);
			}
		}
		
		RequestHandler.Evaluator.add(this, "onGet",	portal.prefix() + "**");
		RequestHandler.Evaluator.add(this, "onGetRedirect",
				portal.prefix().getPath().substring(
						0, portal.prefix().getPath().length() - 1));
		
		portalBaseModel = createPortalBaseModel();

		// Handlers attached to the portal side channel
		Handler.Evaluator.add(this, "onPortalReady", portal.channel());
		Handler.Evaluator.add(this, "onKeyValueStoreData", portal.channel());
		Handler.Evaluator.add(this, "onResourceRequestCompleted", portal.channel());
		Handler.Evaluator.add(this, "onOutput", portal.channel());
		Handler.Evaluator.add(this, "onPortalSessionCommand", portal.channel());
		Handler.Evaluator.add(this, "onSetLocale", portal.channel());
		Handler.Evaluator.add(this, "onSetTheme", portal.channel());
	}

	private Map<String,Object> createPortalBaseModel() {
		// Create portal model
		portalBaseModel = new HashMap<>();
		portalBaseModel.put("resourceUrl", new TemplateMethodModelEx() {
			@Override
			public Object exec(@SuppressWarnings("rawtypes") List arguments)
					throws TemplateModelException {
				@SuppressWarnings("unchecked")
				List<TemplateModel> args = (List<TemplateModel>)arguments;
				if (!(args.get(0) instanceof SimpleScalar)) {
					throw new TemplateModelException("Not a string.");
				}
				return portal.prefix().resolve(
						((SimpleScalar)args.get(0)).getAsString()).getRawPath();
			}
		});
		portalBaseModel.put("useMinifiedResources", useMinifiedResources);
		portalBaseModel.put("minifiedExtension", 
				useMinifiedResources ? ".min" : "");
		portalBaseModel.put(
				"portalSessionRefreshInterval", portalSessionRefreshInterval);
		portalBaseModel.put(
				"portalSessionInactivityTimeout", portalSessionInactivityTimeout);
		return Collections.unmodifiableMap(portalBaseModel);
	}

	/**
	 * Sets the portal session network timeout. The portal session will be
	 * removed if no messages have been received from the portal session
	 * for the given number of milliseconds. The value defaults to 45 seconds.
	 * 
	 * @param timeout the timeout in milli seconds
	 * @return the portal view for easy chaining
	 */
	public PortalWeblet setPortalSessionNetworkTimeout(long timeout) {
		portalSessionNetworkTimeout = timeout;
		return this;
	}

	/**
	 * Sets the portal session refresh interval. The portal code in the
	 * browser will send a keep alive packet if there has been no user
	 * activity for more than the given number of milliseconds. The value 
	 * defaults to 30 seconds.
	 * 
	 * @param interval the interval in milliseconds
	 * @return the portal view for easy chaining
	 */
	public PortalWeblet setPortalSessionRefreshInterval(long interval) {
		portalSessionRefreshInterval = interval;
		portalBaseModel = createPortalBaseModel();
		return this;
	}

	/**
	 * Sets the portal session inactivity timeout. If there has been no
	 * user activity for more than the given number of milliseconds the
	 * portal code stops sending keep alive packets and displays a
	 * message to the user. The value defaults to -1 (no timeout).
	 * 
	 * @param timeout the timeout in milliseconds
	 * @return the portal view for easy chaining
	 */
	public PortalWeblet setPortalSessionInactivityTimeout(long timeout) {
		portalSessionInactivityTimeout = timeout;
		portalBaseModel = createPortalBaseModel();
		return this;
	}

	/**
	 * @return the useMinifiedResources
	 */
	public boolean useMinifiedResources() {
		return useMinifiedResources;
	}

	/**
	 * @param useMinifiedResources the useMinifiedResources to set
	 */
	public void setUseMinifiedResources(boolean useMinifiedResources) {
		this.useMinifiedResources = useMinifiedResources;
		portalBaseModel = createPortalBaseModel();
	}

	/**
	 * The service loader must be created lazily, else the OSGi
	 * service mediator doesn't work properly.
	 * 
	 * @return
	 */
	private ServiceLoader<ThemeProvider> themeLoader() {
		if (themeLoader != null) {
			return themeLoader;
		}
		return themeLoader = ServiceLoader.load(ThemeProvider.class);
	}
	
	void setResourceBundleSupplier(
			Function<Locale,ResourceBundle> supplier) {
		this.resourceBundleSupplier = supplier;
	}
	
	void setFallbackResourceSupplier(
			BiFunction<ThemeProvider,String,URL> supplier) {
		this.fallbackResourceSupplier = supplier;
	}
	
	RenderSupport renderSupport() {
		return renderSupport;
	}
	
	@RequestHandler(dynamic=true)
	public void onGetRedirect(GetRequest event, IOSubchannel channel) 
			throws InterruptedException, IOException, ParseException {
		HttpResponse response = event.httpRequest().response().get();
		response.setStatus(HttpStatus.MOVED_PERMANENTLY)
			.setContentType("text", "plain", "utf-8")
			.setField(HttpField.LOCATION, portal.prefix());
		channel.respond(new Response(response));
		try {
			channel.respond(Output.from(portal.prefix().toString()
					.getBytes("utf-8"), true));
		} catch (UnsupportedEncodingException e) {
			// Supported by definition
		}
		event.setResult(true);
		event.stop();
	}
	
	@RequestHandler(dynamic=true)
	public void onGet(GetRequest event, IOSubchannel channel) 
			throws InterruptedException, IOException, ParseException {
		URI requestUri = event.requestUri();
		// Append trailing slash, if missing
		if ((requestUri.getRawPath() + "/").equals(
				portal.prefix().getRawPath())) {
			requestUri = portal.prefix();
		}
		
		// Request for portal? (Only valid with session)
		if (!requestUri.getRawPath().startsWith(portal.prefix().getRawPath())
				|| !event.associated(Session.class).isPresent()) {
			return;
		}
		
		// Normalize and evaluate
		requestUri = portal.prefix().relativize(
				URI.create(requestUri.getRawPath()));
		if (requestUri.getRawPath().isEmpty()) {
			renderPortal(event, channel);
			return;
		}
		URI subUri = uriFromPath("portal-resource/").relativize(requestUri);
		if (!subUri.equals(requestUri)) {
			final String resource = subUri.getPath();
			ResponseCreationSupport.sendStaticContent(event, channel, 
					p -> PortalWeblet.this.getClass().getResource(resource), null);
			return;
		}
		subUri = uriFromPath("page-resource/").relativize(requestUri);
		if (!subUri.equals(requestUri)) {
			requestPageResource(event, channel, subUri);
			return;
		}
		subUri = uriFromPath("portal-session/").relativize(requestUri);
		if (!subUri.equals(requestUri)) {
			handleSessionRequest(event, channel, subUri);
			return;
		}
		subUri = uriFromPath("theme-resource/").relativize(requestUri);
		if (!subUri.equals(requestUri)) {
			sendThemeResource(event, channel, subUri.getPath());
			return;
		}
		subUri = uriFromPath("portlet-resource/").relativize(requestUri);
		if (!subUri.equals(requestUri)) {
			requestPortletResource(event, channel, subUri);
			return;
		}
	}

	private void renderPortal(GetRequest event, IOSubchannel channel)
		throws IOException, InterruptedException {
		event.setResult(true);
		event.stop();
		
		// Because language is changed via websocket, locale cookie 
		// may be out-dated
		event.associated(Selection.class)
			.ifPresent(s ->	s.prefer(s.get()[0]));

		// This is a portal session now (can be connected to)
		Session session = event.associated(Session.class).get();
		UUID portalSessionId = UUID.randomUUID();
		@SuppressWarnings("unchecked")
		Map<URI,UUID> knownIds = (Map<URI,UUID>)session.computeIfAbsent(
				PORTAL_SESSION_IDS, k -> new HashMap<URI,UUID>());
		knownIds.put(portal.prefix(), portalSessionId);
		
		// Prepare response
		HttpResponse response = event.httpRequest().response().get();
		MediaType mediaType = MediaType.builder().setType("text", "html")
				.setParameter("charset", "utf-8").build();
		response.setField(HttpField.CONTENT_TYPE, mediaType);
		response.setStatus(HttpStatus.OK);
		response.setHasPayload(true);
		channel.respond(new Response(response));
		try (Writer out = new OutputStreamWriter(new ByteBufferOutputStream(
				channel, channel.responsePipeline()), "utf-8")) {
			Map<String,Object> portalModel = new HashMap<>(portalBaseModel);

			// Portal Session UUID
			portalModel.put("portalSessionId", portalSessionId.toString());
			
			// Add locale
			final Locale locale = event.associated(Selection.class).map(
					s -> s.get()[0]).orElse(Locale.getDefault());
			portalModel.put("locale", locale);

			// Add supported locales
			final Collator coll = Collator.getInstance(locale);
			final Comparator<LanguageInfo> comp 
				= new Comparator<PortalWeblet.LanguageInfo>() {
				@Override
				public int compare(LanguageInfo o1,  LanguageInfo o2) {
					return coll.compare(o1.getLabel(), o2.getLabel());
				}
			};
			LanguageInfo[] languages = supportedLocales.stream()
					.map(l -> new LanguageInfo(l))
					.sorted(comp).toArray(size -> new LanguageInfo[size]);
			portalModel.put("supportedLanguages", languages);

			// Add localization
			final ResourceBundle additionalResources = resourceBundleSupplier == null
					? null : resourceBundleSupplier.apply(locale);
			final ResourceBundle baseResources = ResourceBundle.getBundle(
					getClass().getPackage().getName() + ".l10n", locale,
					ResourceBundle.Control.getNoFallbackControl(
							ResourceBundle.Control.FORMAT_DEFAULT));
			portalModel.put("_", new TemplateMethodModelEx() {
				@Override
				public Object exec(@SuppressWarnings("rawtypes") List arguments)
						throws TemplateModelException {
					@SuppressWarnings("unchecked")
					List<TemplateModel> args = (List<TemplateModel>)arguments;
					if (!(args.get(0) instanceof SimpleScalar)) {
						throw new TemplateModelException("Not a string.");
					}
					String key = ((SimpleScalar)args.get(0)).getAsString();
					try {
						return additionalResources.getString(key);
					} catch (MissingResourceException e) {
						// try base resources
					}
					try {
						return baseResources.getString(key);
					} catch (MissingResourceException e) {
						// no luck
					}
					return key;
				}
			});

			// Add themes. Doing this on every reload allows themes
			// to be added dynamically. Note that we must load again
			// (not reload) in order for this to work in an OSGi environment.
			themeLoader = ServiceLoader.load(ThemeProvider.class);
			portalModel.put("themeInfos", 
					StreamSupport.stream(themeLoader().spliterator(), false)
					.map(t -> new ThemeInfo(t.themeId(), t.themeName()))
					.sorted().toArray(size -> new ThemeInfo[size]));
			
			Template tpl = fmConfig.getTemplate("portal.ftlh");
			tpl.process(portalModel, out);
		} catch (TemplateException e) {
			throw new IOException(e);
		}
	}

	private void sendThemeResource(GetRequest event, IOSubchannel channel,
			String resource) throws ParseException {
		// Get resource
		ThemeProvider themeProvider = event.associated(Session.class).flatMap(
				session -> Optional.ofNullable(session.get("themeProvider")).flatMap(
						themeId -> StreamSupport
						.stream(themeLoader().spliterator(), false)
						.filter(t -> t.themeId().equals(themeId)).findFirst()
				)).orElse(baseTheme);
		URL resourceUrl;
		try {
			resourceUrl = themeProvider.getResource(resource);
		} catch (ResourceNotFoundException e) {
			try {
				resourceUrl = baseTheme.getResource(resource);
			} catch (ResourceNotFoundException e1) {
				resourceUrl = fallbackResourceSupplier.apply(themeProvider, resource);
				if (resourceUrl == null) {
					return;
				}
			}
		}
		final URL resUrl = resourceUrl;
		ResponseCreationSupport.sendStaticContent(event, channel, 
				p -> resUrl, null);
	}

	private void requestPageResource(GetRequest event, IOSubchannel channel,
			URI resource) throws InterruptedException {
		// Send events to providers on portal's channel
		PageResourceRequest pageResourceRequest = new PageResourceRequest(
				uriFromPath(resource.getPath()),
				event.httpRequest().findValue(HttpField.IF_MODIFIED_SINCE, 
						Converters.DATE_TIME).orElse(null),
				event.httpRequest(), channel, renderSupport());
		// Make session available (associate with event, this is not
		// a websocket request).
		event.associated(Session.class).ifPresent(
				session -> pageResourceRequest.setAssociated(Session.class, session));
		event.setResult(true);
		event.stop();
		fire(pageResourceRequest, portalChannel(channel));
	}
	
	private void requestPortletResource(GetRequest event, IOSubchannel channel,
			URI resource) throws InterruptedException {
		String resPath = resource.getPath();
		int sep = resPath.indexOf('/');
		// Send events to portlets on portal's channel
		PortletResourceRequest portletRequest = new PortletResourceRequest(
				resPath.substring(0, sep), 
				uriFromPath(resPath.substring(sep + 1)),
				event.httpRequest().findValue(HttpField.IF_MODIFIED_SINCE, 
						Converters.DATE_TIME).orElse(null),
				event.httpRequest(), channel, renderSupport());
		// Make session available (associate with event, this is not
		// a websocket request).
		event.associated(Session.class).ifPresent(
				session -> portletRequest.setAssociated(Session.class, session));
		event.setResult(true);
		event.stop();
		fire(portletRequest, portalChannel(channel));
	}

	/**
	 * The portal channel for getting resources. Resource providers
	 * respond on the same event pipeline as they receive, because
	 * handling is just a mapping to {@link ResourceRequestCompleted}.
	 *
	 * @param channel the channel
	 * @return the IO subchannel
	 */
	private IOSubchannel portalChannel(IOSubchannel channel) {
		@SuppressWarnings("unchecked")
		Optional<LinkedIOSubchannel> portalChannel
			= (Optional<LinkedIOSubchannel>)LinkedIOSubchannel
				.downstreamChannel(portal, channel);
		return portalChannel.orElseGet(
				() -> new PortalResourceChannel(
						portal, channel, activeEventPipeline()));
	}

	@Handler(dynamic=true)
	public void onResourceRequestCompleted(
			ResourceRequestCompleted event, PortalResourceChannel channel) 
					throws IOException, InterruptedException {
		event.stop();
		if (event.event().get() == null) {
			ResponseCreationSupport.sendResponse(event.event().httpRequest(), 
					event.event().httpChannel(), HttpStatus.NOT_FOUND);
			return;
		}
		event.event().get().process();
	}
	
	private void handleSessionRequest(
			GetRequest event, IOSubchannel channel, URI subUri)
					throws InterruptedException, IOException, ParseException {
		// Must be WebSocket request.
		if (!event.httpRequest().findField(
				HttpField.UPGRADE, Converters.STRING_LIST)
				.map(f -> f.value().containsIgnoreCase("websocket"))
				.orElse(false)) {
			return;
		}
		// Can only connect to sessions that have been prepared
		// by loading the portal. (Prevents using a newly created
		// browser session from being (re-)connected to after a 
		// long disconnect or restart and, of course, CSF).
		String portalSessionId = subUri.getPath();
		final Session browserSession = event.associated(Session.class).get();
		@SuppressWarnings("unchecked")
		Map<URI,UUID> knownIds = (Map<URI,UUID>)browserSession.computeIfAbsent(
				PORTAL_SESSION_IDS, k -> new HashMap<URI,UUID>());
		if (!UUID.fromString(portalSessionId).equals(knownIds.get(portal.prefix()))) {
			channel.respond(new WebSocketAccepted(event)).get();
			@SuppressWarnings("resource")
			CharBufferWriter out = new CharBufferWriter(channel, 
					channel.responsePipeline()).suppressClose();
			new SimplePortalCommand("reload").toJson(out);
			out.close();
			event.stop();
			return;
		}
		// Reuse old portal session if still available
		String oldPortalSessionId = Optional.ofNullable(
				event.httpRequest().queryData().get("was")).map(l -> l.get(0))
				.orElse(null);
		PortalSession portalSession = Optional.ofNullable(
				oldPortalSessionId).flatMap(opsId -> PortalSession.lookup(opsId))
				.map(ps -> ps.replaceId(portalSessionId))
				.orElse(PortalSession.lookupOrCreate(
						portalSessionId, portal, portalSessionNetworkTimeout))
				.setUpstreamChannel(channel)
				.setEventPipeline(activeEventPipeline())
				.setSession(browserSession);
		channel.setAssociated(PortalSession.class, portalSession);
		// Channel now used as JSON input
		channel.setAssociated(this, new WsInputReader());
		channel.respond(new WebSocketAccepted(event));
		event.stop();
	}

	@Handler
	public void onInput(Input<CharBuffer> event, IOSubchannel wsChannel)
			throws IOException {
		Optional<WsInputReader> optWsInputReader 
			= wsChannel.associated(this, WsInputReader.class);
		if (!optWsInputReader.isPresent()) {
			return;
		}
		JsonObject json = optWsInputReader.get().toJsonObject(event);
		if (json != null) {
			// Fully decoded JSON available.
			Optional<PortalSession> psc = wsChannel.associated(
					PortalSession.class);
			if (psc.isPresent()) {
				// Portal session established, check for special disconnect
				if ("disconnect".equals(json.getString("method"))
						&& psc.get().portalSessionId().equals(
								json.getJsonArray("params").getString(0))) {
					psc.get().close();
					return;
				}
				// Ordinary message from portal (view) to server.
				psc.get().refresh();
				if("keepAlive".equals(json.getString("method"))) {
					return;
				}
				fire(new JsonInput(json), psc.get());
				return;
			}
		}
	}
	
	/**
	 * Handles the closed event from the web socket.
	 * 
	 * @param event the event
	 * @param wsChannel the WebSocket channel
	 */
	@Handler
	public void onClosed(Closed event, IOSubchannel wsChannel) {
		wsChannel.associated(PortalSession.class).ifPresent(psc -> {
			psc.upstreamChannel().ifPresent(upstream -> {
				if (upstream.equals(wsChannel)) {
					psc.setUpstreamChannel(null);
				}
			});
		});
	}
	
	@Handler(dynamic=true)
	public void onPortalReady(PortalReady event, PortalSession channel) {
		String principal = 	Utils.userFromSession(channel.browserSession())
				.map(UserPrincipal::toString).orElse("");
		KeyValueStoreQuery query = new KeyValueStoreQuery(
				"/" + principal + "/themeProvider", channel);
		fire(query, channel);
	}

	@Handler(dynamic=true)
	public void onKeyValueStoreData(
			KeyValueStoreData event, PortalSession channel) 
					throws JsonDecodeException {
		Session session = channel.browserSession();
		String principal = Utils.userFromSession(session)
				.map(UserPrincipal::toString).orElse("");
		if (!event.event().query().equals("/" + principal + "/themeProvider")) {
			return;
		}
		if (!event.data().values().iterator().hasNext()) {
			return;
		}
		String requestedThemeId = event.data().values().iterator().next();
		ThemeProvider themeProvider = Optional.ofNullable(
				session.get("themeProvider")).flatMap(
						themeId -> StreamSupport
						.stream(themeLoader().spliterator(), false)
						.filter(t -> t.themeId().equals(themeId)).findFirst()
				).orElse(baseTheme);
		if (!themeProvider.themeId().equals(requestedThemeId)) {
			fire(new SetTheme(requestedThemeId), channel);
		}
	}
	
	@Handler(dynamic=true)
	public void onOutput(Output<?> event, LinkedIOSubchannel channel) {
		channel.upstreamChannel().respond(new Output<>(event));
	}
	
	@Handler(dynamic=true)
	public void onSetLocale(SetLocale event, PortalSession channel)
			throws InterruptedException, IOException {
		Session session = channel.browserSession();
		if (session != null) {
			Selection selection = (Selection)session.get(Selection.class);
			if (selection != null) {
				supportedLocales.stream()
				.filter(l -> l.equals(event.locale())).findFirst()
				.ifPresent(l -> selection.prefer(l));
			}
		}
		channel.respond(new SimplePortalCommand("reload"));
	}
	
	@Handler(dynamic=true)
	public void onSetTheme(SetTheme event, PortalSession channel)
			throws InterruptedException, IOException {
		ThemeProvider themeProvider = StreamSupport
			.stream(themeLoader().spliterator(), false)
			.filter(t -> t.themeId().equals(event.theme())).findFirst()
			.orElse(baseTheme);
		channel.browserSession().put("themeProvider", themeProvider.themeId());
		channel.respond(new KeyValueStoreUpdate().update(
				"/" + Utils.userFromSession(channel.browserSession())
				.map(UserPrincipal::toString).orElse("") 
				+ "/themeProvider", themeProvider.themeId())).get();
		channel.respond(new SimplePortalCommand("reload"));
	}
	
	@Handler(dynamic=true, priority=-1000)
	public void onPortalSessionCommand(
			PortalCommand event, PortalSession channel)
			throws InterruptedException, IOException {
		Optional<IOSubchannel> optUpstream = channel.upstreamChannel();
		if (optUpstream.isPresent()) {
			IOSubchannel upstream = optUpstream.get();
			@SuppressWarnings("resource")
			CharBufferWriter out = new CharBufferWriter(upstream, 
					upstream.responsePipeline()).suppressClose();
			event.toJson(out);
		}
	}
	
	private class WsInputReader {

		private PipedWriter decodeWriter;
		private Future<JsonObject> decodeResult;
		
		public JsonObject toJsonObject(Input<CharBuffer> event)
						throws IOException {
			CharBuffer buffer = event.buffer().backingBuffer();
			if (decodeWriter == null) {
				decodeWriter = new PipedWriter();
				PipedReader reader = new PipedReader(
						decodeWriter, buffer.capacity());
				decodeResult = activeEventPipeline().executorService()
					.submit(new DecodeTask(reader));
			}
			decodeWriter.append(buffer);
			if (event.isEndOfRecord()) {
				decodeWriter.close();
				decodeWriter = null;
				try {
					return decodeResult.get();
				} catch (ExecutionException e) {
					if (e.getCause() instanceof IOException) {
						throw (IOException)e.getCause();
					}
					throw new IOException(e);
				} catch (InterruptedException e) {
					throw new IOException(e);
				}
			}
			return null;
		}
		
		private class DecodeTask implements Callable<JsonObject> {

			private Reader reader;
			
			public DecodeTask(Reader reader) {
				this.reader = reader;
			}

			@Override
			public JsonObject call() throws IOException {
				try (Reader in = reader) {
					JsonReader reader = Json.createReader(in);
					return reader.readObject();
				}
			}
		}
	}

	public static class LanguageInfo {
		private Locale locale;

		/**
		 * @param locale
		 */
		public LanguageInfo(Locale locale) {
			this.locale = locale;
		}

		/**
		 * @return the locale
		 */
		public Locale getLocale() {
			return locale;
		}
		
		public String getLabel() {
			String str = locale.getDisplayName(locale);
			return Character.toUpperCase(str.charAt(0)) + str.substring(1);
		}
	}
	
	public static class ThemeInfo implements Comparable<ThemeInfo> {
		private String id;
		private String name;
		
		/**
		 * @param id
		 * @param name
		 */
		public ThemeInfo(String id, String name) {
			super();
			this.id = id;
			this.name = name;
		}
		
		/**
		 * @return the id
		 */
		public String id() {
			return id;
		}
		
		/**
		 * @return the name
		 */
		public String name() {
			return name;
		}

		/* (non-Javadoc)
		 * @see java.lang.Comparable#compareTo(java.lang.Object)
		 */
		@Override
		public int compareTo(ThemeInfo other) {
			return name().compareToIgnoreCase(other.name());
		}
	}
	
	/**
	 * Create a {@link URI} from a path. This is similar to calling
	 * `new URI(null, null, path, null)` with the {@link URISyntaxException}
	 * converted to a {@link IllegalArgumentException}.
	 * 
	 * @param path the path
	 * @return the uri
	 * @throws IllegalArgumentException if the string violates 
	 * RFC 2396
	 */
	public static URI uriFromPath(String path) throws IllegalArgumentException {
		try {
			return new URI(null, null, path, null);
		} catch (URISyntaxException e) {
			throw new IllegalArgumentException(e);
		}
	}
	
	/**
	 * The channel used to send {@link PageResourceRequest}s and
	 * {@link PortletResourceRequest}s to the portlets (via the
	 * portal).
	 */
	public class PortalResourceChannel extends LinkedIOSubchannel {

		public PortalResourceChannel(Manager hub,
		        IOSubchannel upstreamChannel, EventPipeline responsePipeline) {
			super(hub, hub.channel(), upstreamChannel, responsePipeline);
		}
	}
	
	private class RenderSupportImpl implements RenderSupport {

		/* (non-Javadoc)
		 * @see org.jgrapes.portal.RenderSupport#portletResource(java.lang.String, java.net.URI)
		 */
		@Override
		public URI portletResource(String portletType, URI uri) {
			return portal.prefix().resolve(uriFromPath(
					"portlet-resource/" + portletType + "/")).resolve(uri);
		}

		/* (non-Javadoc)
		 * @see org.jgrapes.portal.RenderSupport#pageResource(java.net.URI)
		 */
		@Override
		public URI pageResource(URI uri) {
			return portal.prefix().resolve(uriFromPath(
					"page-resource/")).resolve(uri);
		}

		/* (non-Javadoc)
		 * @see org.jgrapes.portal.RenderSupport#useMinifiedResources()
		 */
		@Override
		public boolean useMinifiedResources() {
			return useMinifiedResources;
		}
		
	}

}