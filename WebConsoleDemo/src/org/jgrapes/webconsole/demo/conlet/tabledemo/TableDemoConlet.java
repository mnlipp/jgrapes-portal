/*
 * JGrapes Event Driven Framework
 * Copyright (C) 2018 Michael N. Lipp
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

package org.jgrapes.webconsole.demo.conlet.tabledemo;

import freemarker.core.ParseException;
import freemarker.template.MalformedTemplateNameException;
import freemarker.template.Template;
import freemarker.template.TemplateNotFoundException;

import java.io.IOException;
import java.util.Optional;
import java.util.Set;

import org.jgrapes.core.Channel;
import org.jgrapes.core.Event;
import org.jgrapes.core.Manager;
import org.jgrapes.core.annotation.Handler;
import org.jgrapes.http.Session;
import org.jgrapes.webconsole.base.AbstractConlet.PortletBaseModel;
import org.jgrapes.webconsole.base.Conlet.RenderMode;
import org.jgrapes.webconsole.base.ConsoleSession;
import org.jgrapes.webconsole.base.events.AddConletRequest;
import org.jgrapes.webconsole.base.events.AddConletType;
import org.jgrapes.webconsole.base.events.ConsoleReady;
import org.jgrapes.webconsole.base.events.DeleteConlet;
import org.jgrapes.webconsole.base.events.DeleteConletRequest;
import org.jgrapes.webconsole.base.events.RenderConletRequest;
import org.jgrapes.webconsole.base.events.RenderConletRequestBase;
import org.jgrapes.webconsole.base.freemarker.FreeMarkerComponent;

/**
 * 
 */
public class TableDemoConlet extends FreeMarkerComponent<PortletBaseModel> {

    private static final Set<RenderMode> MODES = RenderMode.asSet(
        RenderMode.DeleteablePreview, RenderMode.View);

    /**
     * Creates a new component with its channel set to the given 
     * channel.
     * 
     * @param componentChannel the channel that the component's 
     * handlers listen on by default and that 
     * {@link Manager#fire(Event, Channel...)} sends the event to 
     */
    public TableDemoConlet(Channel componentChannel) {
        super(componentChannel);
    }

    @Handler
    public void onPortalReady(ConsoleReady event, ConsoleSession portalSession)
            throws TemplateNotFoundException, MalformedTemplateNameException,
            ParseException, IOException {
        // Add HelloWorldConlet resources to page
        portalSession.respond(new AddConletType(type())
            .setDisplayNames(
                displayNames(portalSession.supportedLocales(), "portletName"))
            .addRenderMode(RenderMode.View));
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
    protected Optional<PortletBaseModel> stateFromSession(
            Session session, String portletId) {
        if (portletId.startsWith(type() + "-")) {
            return Optional.of(new PortletBaseModel(portletId));
        }
        return Optional.empty();
    }

    @Override
    public String doAddPortlet(AddConletRequest event,
            ConsoleSession channel) throws Exception {
        String portletId = generatePortletId();
        PortletBaseModel portletModel = putInSession(
            channel.browserSession(), new PortletBaseModel(portletId));
        renderPortlet(event, channel, portletModel);
        return portletId;
    }

    /*
     * (non-Javadoc)
     * 
     * @see org.jgrapes.portal.AbstractPortlet#doRenderPortlet
     */
    @Override
    protected void doRenderPortlet(RenderConletRequest event,
            ConsoleSession channel, String portletId,
            PortletBaseModel portletModel) throws Exception {
        renderPortlet(event, channel, portletModel);
    }

    private void renderPortlet(RenderConletRequestBase<?> event,
            ConsoleSession channel, PortletBaseModel portletModel)
            throws TemplateNotFoundException, MalformedTemplateNameException,
            ParseException, IOException {
        if (event.renderPreview()) {
            Template tpl
                = freemarkerConfig().getTemplate("TableDemo-preview.ftl.html");
            channel.respond(new RenderPortletFromTemplate(event,
                TableDemoConlet.class, portletModel.getPortletId(),
                tpl, fmModel(event, channel, portletModel))
                    .setRenderMode(RenderMode.Preview)
                    .setSupportedModes(MODES)
                    .setForeground(event.isForeground()));
        }
        if (event.renderModes().contains(RenderMode.View)) {
            Template tpl
                = freemarkerConfig().getTemplate("TableDemo-view.ftl.html");
            channel.respond(new RenderPortletFromTemplate(event,
                TableDemoConlet.class, portletModel.getPortletId(),
                tpl, fmModel(event, channel, portletModel))
                    .setRenderMode(RenderMode.View)
                    .setSupportedModes(MODES)
                    .setForeground(event.isForeground()));
        }
    }

    /*
     * (non-Javadoc)
     * 
     * @see org.jgrapes.portal.AbstractPortlet#doDeletePortlet
     */
    @Override
    protected void doDeletePortlet(DeleteConletRequest event,
            ConsoleSession channel, String portletId,
            PortletBaseModel portletState) throws Exception {
        channel.respond(new DeleteConlet(portletId));
    }

}