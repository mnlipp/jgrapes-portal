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

package org.jgrapes.portal.base.events;

import java.util.Set;

import org.jgrapes.portal.base.Portlet.RenderMode;
import org.jgrapes.portal.base.RenderSupport;

/**
 * Sent to the portal (server) if an existing portlet instance 
 * should be updated. The portal server usually responds with 
 * a {@link RenderPortlet} event that has as payload the
 * HTML that displays the portlet on the portal page.
 * 
 * ![Event Sequence](RenderPortletRequestSeq.svg)
 * 
 * The event's result must be set to `true` by the rendering portlet.
 * 
 * @startuml RenderPortletRequestSeq.svg
 * hide footbox
 * 
 * Browser -> Portal: "renderPortletRequest"
 * activate Portal
 * Portal -> Portlet: RenderPortletRequest
 * deactivate Portal
 * activate Portlet
 * Portlet -> Portal: RenderPortlet
 * deactivate Portlet
 * activate Portal
 * Portal -> Browser: "renderPortlet"
 * deactivate Portal
 * 
 * @enduml
 */
public class RenderPortletRequest extends RenderPortletRequestBase<Boolean> {

    private final String portletId;

    /**
     * Creates a new request.
     *
     * @param renderSupport the render support for generating the response
     * @param portletId the portlet to be updated
     * @param renderModes the render options
     */
    public RenderPortletRequest(RenderSupport renderSupport,
            String portletId, Set<RenderMode> renderModes) {
        super(renderSupport, renderModes);
        this.portletId = portletId;
    }

    /**
     * Returns the portlet id.
     * 
     * @return the portlet id
     */
    public String portletId() {
        return portletId;
    }

    @Override
    public boolean isForeground() {
        return renderModes().contains(RenderMode.Foreground);
    }

    /**
     * Checks if the portlet has been rendered (i.e. the event has been
     * handled).
     *
     * @return true, if successful
     */
    public boolean hasBeenRendered() {
        return !currentResults().isEmpty() && currentResults().get(0);
    }
}
