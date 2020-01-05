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

import org.jgrapes.core.Event;
import org.jgrapes.portal.base.Portlet.RenderMode;
import org.jgrapes.portal.base.RenderSupport;

/**
 * The base class for events that result in a portlet being rendered.
 */
public abstract class RenderPortletRequestBase<T> extends Event<T> {
    private final RenderSupport renderSupport;
    private final Set<RenderMode> renderModes;

    /**
     * Creates a new event.
     *
     * @param renderSupport the render support
     * @param renderModes the render modes
     */
    public RenderPortletRequestBase(
            RenderSupport renderSupport, Set<RenderMode> renderModes) {
        this.renderSupport = renderSupport;
        this.renderModes = renderModes;
    }

    /**
     * Returns the render support.
     * 
     * @return the render support
     */
    public RenderSupport renderSupport() {
        return renderSupport;
    }

    /**
     * Returns the render modes.
     * 
     * @return the render modes
     */
    public Set<RenderMode> renderModes() {
        return renderModes;
    }

    /**
     * Shortcut for checking if {@link #renderModes()} contains
     * {@link RenderMode#Preview} or {@link RenderMode#DeleteablePreview}.
     *
     * @return true, if condition matched
     */
    public boolean renderPreview() {
        return renderModes.contains(RenderMode.Preview)
            || renderModes.contains(RenderMode.DeleteablePreview);
    }

    /**
     * Indicates if the portlet is to be put in the foreground.
     * 
     * @return the result
     */
    public abstract boolean isForeground();

}
