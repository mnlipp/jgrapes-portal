/*
 * JGrapes Event Driven Framework
 * Copyright (C) 2017-2018 Michael N. Lipp
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU Affero General Public License as published by 
 * the Free Software Foundation; either version 3 of the License, or 
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful, but 
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License 
 * for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License along 
 * with this program; if not, see <http://www.gnu.org/licenses/>.
 */

package org.jgrapes.webcomp.sysinfo;

import freemarker.core.ParseException;
import freemarker.template.MalformedTemplateNameException;
import freemarker.template.Template;
import freemarker.template.TemplateNotFoundException;

import java.beans.ConstructorProperties;
import java.io.IOException;
import java.time.Duration;
import java.util.Optional;
import java.util.Properties;
import java.util.Set;

import org.jgrapes.core.Channel;
import org.jgrapes.core.Event;
import org.jgrapes.core.Manager;
import org.jgrapes.core.annotation.Handler;
import org.jgrapes.http.Session;
import org.jgrapes.webcon.base.AbstractComponent;
import org.jgrapes.webcon.base.ConsoleComponent.RenderMode;
import org.jgrapes.webcon.base.ConsoleSession;
import org.jgrapes.webcon.base.WebConsoleUtils;
import org.jgrapes.webcon.base.events.AddComponentRequest;
import org.jgrapes.webcon.base.events.AddComponentType;
import org.jgrapes.webcon.base.events.AddPageResources.ScriptResource;
import org.jgrapes.webcon.base.events.ConsoleReady;
import org.jgrapes.webcon.base.events.DeleteComponent;
import org.jgrapes.webcon.base.events.DeleteComponentRequest;
import org.jgrapes.webcon.base.events.NotifyComponentModel;
import org.jgrapes.webcon.base.events.NotifyPortletView;
import org.jgrapes.webcon.base.events.RenderComponentRequest;
import org.jgrapes.webcon.base.events.RenderComponentRequestBase;
import org.jgrapes.webcon.base.freemarker.FreeMarkerComponent;

/**
 * 
 */
public class SysInfoPortlet
        extends FreeMarkerComponent<SysInfoPortlet.SysInfoModel> {

    private static final Set<RenderMode> MODES = RenderMode.asSet(
        RenderMode.DeleteablePreview, RenderMode.View);

    /**
     * The periodically generated update event.
     */
    public static class Update extends Event<Void> {
    }

    /**
     * Creates a new component with its channel set to the given channel.
     * 
     * @param componentChannel the channel that the component's handlers listen
     *            on by default and that {@link Manager#fire(Event, Channel...)}
     *            sends the event to
     */
    public SysInfoPortlet(Channel componentChannel) {
        super(componentChannel);
        setPeriodicRefresh(Duration.ofSeconds(1), () -> new Update());
    }

    /**
     * On {@link ConsoleReady}, fire the {@link AddComponentType}.
     *
     * @param event the event
     * @param portalSession the portal session
     * @throws TemplateNotFoundException the template not found exception
     * @throws MalformedTemplateNameException the malformed template name
     *             exception
     * @throws ParseException the parse exception
     * @throws IOException Signals that an I/O exception has occurred.
     */
    @Handler
    public void onPortalReady(ConsoleReady event, ConsoleSession portalSession)
            throws TemplateNotFoundException, MalformedTemplateNameException,
            ParseException, IOException {
        // Add SysInfoPortlet resources to page
        portalSession.respond(new AddComponentType(type())
            .setDisplayNames(
                displayNames(portalSession.supportedLocales(), "portletName"))
            .addScript(new ScriptResource()
                .setRequires("chart.js")
                .setScriptUri(event.renderSupport().portletResource(
                    type(), "SysInfo-functions.ftl.js")))
            .addCss(event.renderSupport(), WebConsoleUtils.uriFromPath(
                "SysInfo-style.css")));
    }

    /*
     * (non-Javadoc)
     * 
     * @see org.jgrapes.portal.AbstractPortlet#generatePortletId()
     */
    @Override
    protected String generatePortletId() {
        return type() + "-" + super.generatePortletId();
    }

    /*
     * (non-Javadoc)
     * 
     * @see org.jgrapes.portal.AbstractPortlet#modelFromSession
     */
    @Override
    protected Optional<SysInfoModel> stateFromSession(
            Session session, String portletId) {
        if (portletId.startsWith(type() + "-")) {
            return Optional.of(new SysInfoModel(portletId));
        }
        return Optional.empty();
    }

    @Override
    public String doAddPortlet(AddComponentRequest event,
            ConsoleSession portalSession) throws Exception {
        String portletId = generatePortletId();
        SysInfoModel portletModel = putInSession(
            portalSession.browserSession(), new SysInfoModel(portletId));
        renderPortlet(event, portalSession, portletModel);
        return portletId;
    }

    /*
     * (non-Javadoc)
     * 
     * @see org.jgrapes.portal.AbstractPortlet#doRenderPortlet
     */
    @Override
    protected void doRenderPortlet(RenderComponentRequest event,
            ConsoleSession portalSession, String portletId,
            SysInfoModel portletModel) throws Exception {
        renderPortlet(event, portalSession, portletModel);
    }

    @SuppressWarnings("PMD.DataflowAnomalyAnalysis")
    private void renderPortlet(RenderComponentRequestBase<?> event,
            ConsoleSession portalSession, SysInfoModel portletModel)
            throws TemplateNotFoundException, MalformedTemplateNameException,
            ParseException, IOException {
        if (event.renderPreview()) {
            Template tpl
                = freemarkerConfig().getTemplate("SysInfo-preview.ftl.html");
            portalSession.respond(new RenderPortletFromTemplate(event,
                SysInfoPortlet.class, portletModel.getPortletId(),
                tpl, fmModel(event, portalSession, portletModel))
                    .setRenderMode(RenderMode.DeleteablePreview)
                    .setSupportedModes(MODES)
                    .setForeground(event.isForeground()));
            updateView(portalSession, portletModel.getPortletId());
        }
        if (event.renderModes().contains(RenderMode.View)) {
            Template tpl
                = freemarkerConfig().getTemplate("SysInfo-view.ftl.html");
            portalSession.respond(new RenderPortletFromTemplate(event,
                SysInfoPortlet.class, portletModel.getPortletId(),
                tpl, fmModel(event, portalSession, portletModel))
                    .setRenderMode(RenderMode.View)
                    .setSupportedModes(MODES)
                    .setForeground(event.isForeground()));
        }
    }

    private void updateView(ConsoleSession portalSession, String portletId) {
        if (!portalSession.isConnected()) {
            return;
        }
        Runtime runtime = Runtime.getRuntime();
        portalSession.respond(new NotifyPortletView(type(),
            portletId, "updateMemorySizes",
            System.currentTimeMillis(), runtime.maxMemory(),
            runtime.totalMemory(),
            runtime.totalMemory() - runtime.freeMemory()));
    }

    /*
     * (non-Javadoc)
     * 
     * @see org.jgrapes.portal.AbstractPortlet#doDeletePortlet
     */
    @Override
    protected void doDeletePortlet(DeleteComponentRequest event,
            ConsoleSession portalSession, String portletId,
            SysInfoModel retrievedState) throws Exception {
        portalSession.respond(new DeleteComponent(portletId));
    }

    /**
     * Handle the periodic update event by sending {@link NotifyPortletView}
     * events.
     *
     * @param event the event
     * @param portalSession the portal session
     */
    @Handler
    public void onUpdate(Update event, ConsoleSession portalSession) {
        for (String portletId : portletIds(portalSession)) {
            updateView(portalSession, portletId);
        }
    }

    @Override
    @SuppressWarnings("PMD.DoNotCallGarbageCollectionExplicitly")
    protected void doNotifyPortletModel(NotifyComponentModel event,
            ConsoleSession portalSession, SysInfoModel portletState)
            throws Exception {
        event.stop();
        System.gc();
        for (String portletId : portletIds(portalSession)) {
            updateView(portalSession, portletId);
        }
    }

    /**
     * The portlet's model.
     */
    @SuppressWarnings("serial")
    public static class SysInfoModel
            extends AbstractComponent.PortletBaseModel {

        /**
         * Creates a new model with the given type and id.
         * 
         * @param portletId the portlet id
         */
        @ConstructorProperties({ "portletId" })
        public SysInfoModel(String portletId) {
            super(portletId);
        }

        /**
         * Return the system properties.
         *
         * @return the properties
         */
        public Properties systemProperties() {
            return System.getProperties();
        }

        /**
         * Return the {@link Runtime}.
         *
         * @return the runtime
         */
        public Runtime runtime() {
            return Runtime.getRuntime();
        }
    }

}
