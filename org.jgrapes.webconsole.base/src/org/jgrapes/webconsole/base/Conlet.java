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

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * This interface provides portlet related constants. Portlets
 * need not implement this interface, not even as a marker interface.
 * They only have to expose a specific response behavior to certain
 * events. An overview of the event sequences is provided by the
 * package description. Make sure to read this description first.
 */
public interface Conlet {

    /**
     * The render modes.
     */
    enum RenderMode {
        Preview, DeleteablePreview, View, Edit, Help, Foreground;

        /**
         * Utility method that creates a {@link Set} of render modes
         * from enumerated values.
         *
         * @param modes the modes
         * @return the sets the
         */
        public static Set<RenderMode> asSet(RenderMode... modes) {
            return new HashSet<>(Arrays.asList(modes));
        }
    }

}