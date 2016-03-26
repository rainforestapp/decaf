# Decaf JS

[![Build Status](https://travis-ci.org/juliankrispel/decaf.svg)](https://travis-ci.org/juliankrispel/decaf)

## A coffeescript to ES.next transpiler [Try it out online](http://www.goodafternoon.co/decaf/)

Decaf grew out of the frustration of having to refactor coffeescript to modern JavaScript syntax. It does that for you automatically.

Because decaf uses the coffeescript compiler under the hood it has an advantage over other coffeescript transpilers. Decaf aims to be able to compile all coffeescript, but it is still a fairly young project. Please try decaf and [submit issues](https://github.com/juliankrispel/decaf/issues) if you run into problems, I and a couple of amazing contributors are working hard on completing decaf.

When decaf encounters coffeescript syntax which can't be transpiled to es6 it falls back to using the coffeescript compiler output.

At the moment decaf can transpile a fairly wide range of coffeescript syntax. To get a better idea of which features are supported, please have a look at [the test suite](https://travis-ci.org/juliankrispel/decaf).

## Using decaf as a cli tool

To use decaf as a cli tool install it first via npm.

`npm install decafjs -g` (you can also install it locally, but if you are using it for more projects, installing it globally is recommended)

Now simply point decaf at a file or a directory that you want to convert to es6 and tada:

`decaf coffee-folder`

## Using decaf as a code transform

You can require decaf as a node module and simply use it as a transform. We recommend using it with tools like [jscodeshift](https://github.com/facebook/jscodeshift/).

To install run `npm install decafjs`.

To use it simply require it as any other node module:

```js
var decaf = require('decafjs');
var js = decaf.compile('()-> alert "yoyoyo"');
```

As a second argument, you can parse options to the javascript printer, we use [recast](https://github.com/benjamn/recast) to print the js, so any options you pass as a second argument will be passed onto it.

### Todo

- Single and multi-comment lines (can't be done with coffeescript parser, also it's very unintuitive right now to create comment blocks with the ast-types library)

### Design choices
- [Coffeescript](https://github.com/jashkenas/coffeescript/blob/master/src/nodes.coffee) compiler to build coffeescript syntax tree.
- Using [ast-types](https://github.com/benjamn/ast-types/), a library for building an esprima compatible syntax tree 
- Using [jscodeshift](https://github.com/facebook/jscodeshift/) for code optimisation (like automatically declaring undeclared variables)
