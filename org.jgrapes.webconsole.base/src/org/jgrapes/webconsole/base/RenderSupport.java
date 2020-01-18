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

package org.jgrapes.webconsole.base;

import java.net.URI;

import org.jgrapes.webconsole.base.events.ConletResourceRequest;
import org.jgrapes.webconsole.base.events.PageResourceRequest;

/**
 * Provides support for creating URIs in the portal scope that
 * are forwarded to components listening on the portal channel.  
 */
public interface RenderSupport {

    /**
     * Returns the portal library URI.
     *
     * @param uri the uri
     * @return the uri
     */
    URI portalBaseResource(URI uri);

    /**
     * Convenience method that converts the path to an URI
     * before calling {@link #portalBaseResource(URI)}.
     * 
     * @param path the path 
     * @return the resulting URI
     */
    default URI portalBaseResource(String path) {
        return portalBaseResource(WebConsoleUtils.uriFromPath(path));
    }

    /**
     * Create a reference to a resource provided by the portal.
     * 
     * @param uri the URI  
     * @return the resulting URI
     */
    URI portalResource(URI uri);

    /**
     * Convenience method that converts the path to an URI
     * before calling {@link #portalResource(URI)}.
     * 
     * @param path the path 
     * @return the resulting URI
     */
    default URI portalResource(String path) {
        return portalResource(WebConsoleUtils.uriFromPath(path));
    }

    /**
     * Create a reference to a resource provided by a page resource
     * provider. Requesting the resulting URI results in a 
     * {@link PageResourceRequest}.
     * 
     * @param uri the URI made available as
     * {@link PageResourceRequest#resourceUri()}  
     * @return the resulting URI
     */
    URI pageResource(URI uri);

    /**
     * Convenience method that converts the path to an URI
     * before calling {@link #pageResource(URI)}.
     * 
     * @param path the path 
     * @return the resulting URI
     */
    default URI pageResource(String path) {
        return pageResource(WebConsoleUtils.uriFromPath(path));
    }

    /**
     * Create a reference to a resource provided by a portlet
     * of the given type. Requesting the resulting URI results
     * in a {@link ConletResourceRequest}.
     * 
     * @param portletType the portlet type
     * @param uri the URI made available as 
     * {@link ConletResourceRequest#resourceUri()}
     * @return the resulting URI
     */
    URI portletResource(String portletType, URI uri);

    /**
     * Convenience method that converts the path to an URI
     * before calling {@link #portletResource(String, URI)}.
     * 
     * @param portletType the portlet type
     * @param path the path 
     * @return the resulting URI
     */
    default URI portletResource(String portletType, String path) {
        return portletResource(portletType, WebConsoleUtils.uriFromPath(path));
    }

    /**
     * Indicates if minified resources should be used.
     * 
     * @return the setting
     */
    boolean useMinifiedResources();
}
