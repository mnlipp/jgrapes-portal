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

import java.io.IOException;
import java.io.Writer;
import java.net.URI;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

import org.jdrupes.json.JsonArray;
import org.jgrapes.portal.base.Portlet.RenderMode;
import org.jgrapes.portal.base.RenderSupport;
import org.jgrapes.portal.base.events.AddPageResources.ScriptResource;

/**
 * Adds a portlet type with its global resources (JavaScript and/or CSS) 
 * to the portal page. Specifying global resources result in the respective
 * `<link .../>` or `<script ...></script>` nodes
 * being added to the page's `<head>` node.
 * 
 * This in turn causes the browser to issue `GET` requests that
 * (usually) refer to the portlet's resources. These requests are
 * converted to {@link PortletResourceRequest}s by the portal and
 * sent to the portlets, which must respond to the requests.
 * 
 * The sequence of events is shown in the diagram.
 * 
 * ![Portal Ready Event Sequence](AddPortletTypeSeq.svg)
 * 
 * See {@link ResourceRequest} for details about the processing
 * of the {@link PortletResourceRequest}.
 * 
 * A portelt's JavaScript may (and probably must) make use of
 * the functions provided by the portal page. See the 
 * <a href="../jsdoc/module-jgportal.html">JavaScript
 * documentation of these functions</a> for details.
 * 
 * @startuml AddPortletTypeSeq.svg
 * hide footbox
 * 
 * activate Browser
 * Browser -> Portal: "portalReady"
 * deactivate Browser
 * activate Portal
 * Portal -> PortletX: PortalReady 
 * deactivate Portal
 * activate PortletX
 * PortletX -> Portal: AddPortletType 
 * deactivate PortletX
 * activate Portal
 * Portal -> Browser: "addPortletType"
 * activate Browser
 * deactivate Portal
 * Browser -> Portal: "GET <portlet resource URI>"
 * activate Portal
 * Portal -> PortletX: PortletResourceRequest
 * deactivate Browser
 * activate PortletX
 * deactivate PortletX
 * 
 * @enduml
 */
public class AddPortletType extends PortalCommand {

    private final String portletType;
    private Map<Locale, String> displayNames = Collections.emptyMap();
    private final List<URI> cssUris = new ArrayList<>();
    private final List<ScriptResource> scriptResources = new ArrayList<>();
    private List<RenderMode> renderModes;

    /**
     * Create a new event for the given portlet type.
     * 
     * @param portletType a unique id for the portlet type (usually
     * the class name)
     */
    public AddPortletType(String portletType) {
        this.portletType = portletType;
    }

    /**
     * Return the portlet type.
     * 
     * @return the portlet type
     */
    public String portletType() {
        return portletType;
    }

    /**
     * Sets the display names.
     * 
     * @param displayNames the display names
     * @return the event for easy chaining
     */
    public AddPortletType setDisplayNames(Map<Locale, String> displayNames) {
        this.displayNames = displayNames;
        return this;
    }

    /**
     * Return the display names.
     * 
     * @return the displayNames
     */
    public Map<Locale, String> displayNames() {
        return displayNames;
    }

    /**
     * Add a render mode. The render mode determines how the portlet
     * is initially rendered (i.e. when added). Several modes may be
     * added in order of preference. The default mode (i.e. none 
     * specified) is {@link RenderMode#Preview}.
     *
     * @param mode the mode
     * @return the event for easy chaining
     */
    public AddPortletType addRenderMode(RenderMode mode) {
        if (renderModes == null) {
            renderModes = new ArrayList<>();
        }
        renderModes.add(mode);
        return this;
    }

    /**
     * Return the render modes.
     * 
     * @return the result
     */
    public List<RenderMode> renderModes() {
        if (renderModes == null) {
            return Arrays.asList(RenderMode.Preview);
        }
        return renderModes;
    }

    /**
     * Add a script resource to be requested by the browser.
     * 
     * @param scriptResource the script resource
     * @return the event for easy chaining
     */
    public AddPortletType addScript(ScriptResource scriptResource) {
        scriptResources.add(scriptResource);
        return this;
    }

    /**
     * Add the URI of a CSS resource that is to be added to the
     * header section of the portal page.
     *
     * @param renderSupport the render support for mapping the `uri`
     * @param uri the URI
     * @return the event for easy chaining
     */
    public AddPortletType addCss(RenderSupport renderSupport, URI uri) {
        cssUris.add(renderSupport.portletResource(portletType(), uri));
        return this;
    }

    /**
     * Return all script resources.
     * 
     * @return the result
     */
    public ScriptResource[] scriptResources() {
        return scriptResources.toArray(new ScriptResource[0]);
    }

    /**
     * Return all CSS URIs.
     * 
     * @return the result
     */
    public URI[] cssUris() {
        return cssUris.toArray(new URI[0]);
    }

    @Override
    public void toJson(Writer writer) throws IOException {
        JsonArray strArray = JsonArray.create();
        for (ScriptResource scriptResource : scriptResources()) {
            strArray.append(scriptResource.toJsonValue());
        }
        toJson(writer, "addPortletType", portletType(),
            displayNames().entrySet().stream()
                .collect(Collectors.toMap(e -> e.getKey().toLanguageTag(),
                    e -> e.getValue())),
            Arrays.stream(cssUris()).map(
                uri -> uri.toString()).toArray(String[]::new),
            strArray, renderModes().stream().map(RenderMode::name)
                .toArray(size -> new String[size]));
    }
}
