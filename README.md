JGrapes-Portal
==============

[![Build Status](https://travis-ci.org/mnlipp/jgrapes-portal.svg?branch=master)](https://travis-ci.org/mnlipp/jgrapes-portal)

| Package | Maven |
| ------- | ----- |
| portal  | [![Maven Central](https://img.shields.io/maven-central/v/org.jgrapes/org.jgrapes.portal.svg)](http://search.maven.org/#search%7Cga%7C1%7Ca%3A%22org.jgrapes.portal%22)

See the [project's home page](https://mnlipp.github.io/jgrapes/).

This repository comprises the sources for jars that provide
the portal components.

Themes
------

Additional themes are maintained in an 
[independant repository](https://github.com/mnlipp/jgrapes-portal-themes).

Building
--------

The libraries can be built with `gradle build`. For working with 
the project in Eclipse run `gradle eclipse` before importing the 
project. 

If you want to use 
[buildship](https://projects.eclipse.org/projects/tools.buildship),
import the project as "Gradle / Existing Gradle Project". Should you
encounter the (in)famous 
["sync problem"](https://github.com/eclipse/buildship/issues/478),
simply restart Eclipse.
