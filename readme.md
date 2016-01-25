# Decaf JS

[![Build Status](https://travis-ci.org/juliankrispel/decaf.svg)](https://travis-ci.org/juliankrispel/decaf)

## A coffeescript es6 transpiler

Decaf grew out of the frustration of having to refactor coffeescript to es6 syntax. It does that for you automatically.

Because decaf uses the coffeescript compiler under the hood it can parse all coffeescript.

When decaf encounters coffeescript syntax which can't be transpiled to es6 it falls back to using the coffeescript compiler output.

## Getting Started

Right now, the easiest way to get started using decaf is to require it as a node module and simply use it as a transform. We recommend using it with tools like [jscodeshift](https://github.com/facebook/jscodeshift/).

To install (we're not on npm yet), install it from github `npm install juliankrispel/decaf`.

To use it simply require it as any other node module:

```js
var decaf = require('decaf');
var js = decaf('()-> alert "yoyoyo"');
```

As a second argument, you can parse options to the javascript printer, we use [recast](https://github.com/benjamn/recast) to print the js, so any options you pass as a second argument will be passed onto it.

### Design choices
- [Coffeescript](https://github.com/jashkenas/coffeescript/blob/master/src/nodes.coffee) compiler to build coffeescript syntax tree.
- Using [ast-types](https://github.com/benjamn/ast-types/), a library for building an esprima compatible syntax tree 
- Using [jscodeshift](https://github.com/facebook/jscodeshift/) for code optimisation (like automatically declaring undeclared variables)
