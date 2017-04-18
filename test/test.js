/* eslint-disable no-eval */
import expect from 'expect';
import {compile as _compile} from '../src/parser';
// import {compile as coffeeCompile} from 'coffee-script';


function compile(source) {
  return _compile(source, {tabWidth: 2, quote: 'double'});
}

describe('Values', () => {
  it('strings', () => {
    expect(compile('"yoyoyo"')).toEqual('"yoyoyo";');
    expect(compile(`"#{_.escape(text).replace(/\\n/g, '<br>')}<br>"`))
     .toEqual(`(_.escape(text).replace(/\\n/g, "<br>")) + "<br>";`);
    expect(compile(`'\\''`)).toEqual(`"'";`);
    expect(compile(`"\\""`)).toEqual(`"\\"";`);
    expect(compile(`"\\\\\\\\"`)).toEqual(`"\\\\";`);
  });

  it('numbers', () => {
    expect(compile('123')).toEqual('123;');
  });

  it('floats', () => {
    expect(compile('123.12353443')).toEqual('123.12353443;');
  });

  it('regular expressions', () => {
    expect(compile('/gorigori/gi')).toEqual('/gorigori/gi;');
  });

  it('NaN', () => {
    expect(compile('NaN')).toEqual('NaN;');
  });

  it('booleans', () => {
    expect(compile('true')).toEqual('true;');
    expect(compile('false')).toEqual('false;');
    expect(compile('yes')).toEqual('true;');
    expect(compile('!!yes')).toEqual('!!true;');
    expect(compile('!!!yes')).toEqual('!!!true;');
    expect(compile('no')).toEqual('false;');
  });

  it('arrays', () => {
    expect(compile('[1, 2, 3]')).toEqual('[1, 2, 3];');
  });

  it('objects', () => {
    expect(compile('a: 213, b: "321"')).toEqual('({\n  a: 213,\n  b: "321"\n});');
    expect(compile('false')).toEqual('false;');
  });

  it('undefined', () => {
    expect(compile('undefined')).toEqual('undefined;');
  });

  it('null', () => {
    expect(compile('null')).toEqual('null;');
  });
});

describe('multiline strings', () => {
  it('should escape properly', () => {
    const example =
`"""
"
"""`;
    const expected = String.raw`"\"";`;
    expect(compile(example)).toEqual(expected);
  });

  it('should escape more complex strings properly', () => {
    const example =
`"""
<div id="outer" style="height: #{CONTAINER_HEIGHT}px; overflow: scroll">
  <div id="inner" style="height: #{CONTENT_HEIGHT}px"></div>
</div>
"""`;

    const expected = `"<div id=\\"outer\\" style=\\"height: " + (CONTAINER_HEIGHT) + "px; overflow: scroll\\">\\n  <div id=\\"inner\\" style=\\"height: " + (CONTENT_HEIGHT) + "px\\"></div>\\n</div>";`; // eslint-disable-line max-len
    expect(compile(example)).toEqual(expected);
  });
});

describe('** operator', () => {
  it('compiles to Math.pow', () => {
    const example = `4 ** 5`;
    expect(compile(example)).toEqual(`Math.pow(4, 5);`);
  });

  it('compiles newsted pow operators to Math.pow', () => {
    const example = `4 ** 5 ** 123`;
    expect(compile(example)).toEqual(`Math.pow(4, Math.pow(5, 123));`);
  });
});

describe('throw statements', () => {
  it('throw "error" if success is false', () => {
    const example = 'throw "error" if success is false';
    const expected =
`if (success === false) {
  throw "error";
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('should not be wrapped as IIFE if last func statement', () => {
    const example = `b = -> throw a`;
    const expected =
`var b = function() {
  throw a;
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('throw new Error "boom"', () => {
    const example = 'throw new Error "boom"';
    const expected = `throw new Error("boom");`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('private class statements', () => {
  it('throws an error when private statements are used in a class definition', () => {
    const example =
`class A
  boom()
  a = 123
  @a = 43214
  a: () ->
`;
    expect(compile.bind(this, example)).toThrow();
  });
});

describe('Comment', () => {
  it("doesn't break class declaration and excludes comments", () => {
    const example =
`class A
  ###
  B
  ###
  c: ->`;
    const expected =
`class A {
  c() {}
}`;
    expect(compile(example)).toEqual(expected);
  });
});

// describe('Comments', () => {
//   it('multiline comments in Program', () => {
//     const example =
// `###
// Hello I am a comment
// ###`;
//     const expected =
// `/*
// Hello I am a comment
// */
// `;
//     expect(compile(example)).toEqual(expected);
//   });
//
//   it.only('nested multiline comments', () => {
//     const example =
// `fun = () ->
//  console.log('yoyoyo');
//  ###
//  Hello I am a comment
//  ###`;
//     const expected =
// `var fun = function() {
//  /*
//  Hello I am a comment
//  */
// }`;
//     expect(compile(example)).toEqual(expected);
//   });
// });

describe('Unary Expressions', () => {
  it('correctly converts', () => {
    expect(compile('-boom')).toEqual('-boom;');
    expect(compile('+boom')).toEqual('+boom;');
    expect(compile('+boom')).toEqual('+boom;');
    expect(compile('num++')).toEqual('num++;');
    expect(compile('num--')).toEqual('num--;');
    expect(compile('--num')).toEqual('--num;');
    expect(compile('++num')).toEqual('++num;');
  });
});

describe('new Expressions', () => {
  it('new FooBar', () => {
    expect(compile('new FooBar')).toEqual('new FooBar();');
  });

  it(`new @collection.constructor`, () => {
    expect(compile(`new @collection.constructor`)).toEqual('new this.collection.constructor();');
  });

  it(`new FooBar('bobo')`, () => {
    expect(compile(`new FooBar('bobo')`)).toEqual(`new FooBar("bobo");`);
  });

  it('bom = new FooBar', () => {
    expect(compile('bom = new FooBar')).toEqual('var bom = new FooBar();');
  });

  it('bom = new FooBar(1,2,boom())', () => {
    expect(compile('bom = new FooBar(1,2,boom())')).toEqual('var bom = new FooBar(1, 2, boom());');
  });
});

describe('modulo operator', () => {
  // module function copied from coffeescript compiler output
  function modulo(left, right) { return (+left % (right = +right) + right) % right; }

  it('falls back to modulo utility function', () => {
    const example = `5 %% 3`;
    const expected = `var modulo = function (a, b) { return (+a % (b = +b) + b) % b; };
modulo(5, 3);`;
    expect(compile(example)).toEqual(expected);
  });

  describe('yields the same result as the coffeescript compiler', () => {
    it('-12 %% 13', () => {
      const a = -12;
      const b = 13;
      const example = `${a} %% ${b}`;
      expect(eval(compile(example))).toBe(modulo(a, b));
    });

    it('-12 %% -3', () => {
      const a = -12;
      const b = -3;
      const example = `${a} %% ${b}`;
      expect(eval(compile(example))).toBe(modulo(a, b));
    });

    it('18 %% 13 %% 20', () => {
      const a = 18;
      const b = 13;
      const c = 20;
      const example = `${a} %% ${b} %% ${c}`;
      expect(eval(compile(example))).toBe(modulo(modulo(a, b), c));
    });

    it('-12 %% 13 %% 19', () => {
      const a = -12;
      const b = 13;
      const c = 19;
      const example = `${a} %% ${b} %% ${c}`;
      expect(eval(compile(example))).toBe(modulo(modulo(a, b), c));
    });

    it('4 %% -103 %% -13', () => {
      const a = 4;
      const b = -103;
      const c = -13;
      const example = `${a} %% ${b} %% ${c}`;
      expect(eval(compile(example))).toBe(modulo(modulo(a, b), c));
    });

    it('example 4', () => {
      const a = 12;
      const b = -33;
      const c = 200;
      const d = 139;
      const example = `${a} %% ${b} %% ${c} %% ${d}`;
      expect(eval(compile(example))).toBe(modulo(modulo(modulo(a, b), c), d));
    });
  });
});

describe('Existential Operator', () => {
  it('mapCall uses fallback if variable contains existential operator', () => {
    const example = `@user?.get('name')`;
    const expected =
`var ref;
(ref = this.user) != null ? ref.get("name") : void 0;`;
    expect(compile(example)).toEqual(expected);
  });

  it('foo?', () => {
    const example = 'foo?';
    const expected = 'typeof foo !== "undefined" && foo !== null;';
    expect(compile(example)).toEqual(expected);
  });

  it('foo?.bar', () => {
    const example = 'foo?.bar';
    const expected = 'typeof foo !== "undefined" && foo !== null ? foo.bar : void 0;';
    expect(compile(example)).toEqual(expected);
  });

  it('foo?.bar?', () => {
    const example = 'foo?.bar?';
    const expected = '((typeof foo !== "undefined" && foo !== null ? foo.bar : void 0)) != null;';
    expect(compile(example)).toEqual(expected);
  });

  it('yo = foo?.bar?', () => {
    const example = 'yo = foo?.bar?';
    const expected = `var yo = ((typeof foo !== "undefined" && foo !== null ? foo.bar : void 0)) != null;`;
    expect(compile(example)).toEqual(expected);
  });

  it('yo = foo?.bar?()', () => {
    const example = 'yo = a?.b?.c?()';
    const expected =
`var ref;
var yo = typeof a !== "undefined" && a !== null ? \
((ref = a.b) != null ? (typeof ref.c === "function" ? ref.c() : void 0) : void 0) : void 0;`;
    expect(compile(example)).toEqual(expected);
  });

  it('doSomething (foo) => @bar.baz?.qux', () => {
    const example = 'doSomething (foo) => @bar?';
    const expected =
`doSomething(foo => {
  return this.bar != null;
});`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('Boolean Expression', () => {
  it('a > 123', () => {
    expect(compile('a > 123')).toEqual('a > 123;');
  });

  it('a < 123', () => {
    expect(compile('a < 123')).toEqual('a < 123;');
  });

  it('a <= 123', () => {
    expect(compile('a <= 123')).toEqual('a <= 123;');
  });

  it('a >= 123', () => {
    expect(compile('a >= 123')).toEqual('a >= 123;');
  });

  it('a || 123', () => {
    expect(compile('a || 123')).toEqual('a || 123;');
  });

  it('a or 123', () => {
    expect(compile('a or 123')).toEqual('a || 123;');
  });

  it('a and b', () => {
    expect(compile('a and b')).toEqual('a && b;');
  });

  it('!b', () => {
    expect(compile('!b')).toEqual('!b;');
  });

  it('!!b', () => {
    expect(compile('!!b')).toEqual('!!b;');
  });

  it('!!!b', () => {
    expect(compile('!!!b')).toEqual('!!!b;');
  });

  it(`'hello' in items`, () => {
    expect(compile(`'hello' in items`)).toEqual(`items.includes("hello");`);
  });
});

describe('embedded javascript', () => {
  it('`var b = function(){ console.log(\'foobar\'); }`', () => {
    const example = '`var b = function(){ console.log(\'foobar\'); }`';
    const expected = 'var b = function(){ console.log(\'foobar\'); };';
    expect(compile(example)).toEqual(expected);
  });
});

describe('return statements', () => {
  it('()-> return "boom"', () => {
    const example = '()-> return "boom"';
    const expected =
`(function() {
  return "boom";
});`;
    expect(compile(example)).toEqual(expected);
  });

  it('conditional statements with return in else block', () => {
    const example =
`if bom is true
  console.log 'fooBar'
else
  return false`;
    const expected =
`if (bom === true) {
  console.log("fooBar");
} else {
  return false;
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('a = ()-> return "boom"', () => {
    const example = 'a = ()-> return "boom"';
    const expected =
`var a = function() {
  return "boom";
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('a = ()-> return', () => {
    const example = 'a = ()-> return';
    const expected =
`var a = function() {
  return;
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('a = ()-> return "boom" if b is 123', () => {
    const example = 'a = ()-> return "boom" if b is 123';
    const expected =
`var a = function() {
  if (b === 123) {
    return "boom";
  }
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('inserting return statements after return statements', () => {
    const example =
`a = ()->
  if b is 123
    return "boom"
    'yoyo'`;
    const expected =
`var a = function() {
  if (b === 123) {
    return "boom";
    return "yoyo";
  }
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('return statements in nested conditionals', () => {
    const example =
`a = ()->
  if b is 123
    return "boom"
    return "bloom" if flower is "rose"
    'yoyo'`;
    const expected =
`var a = function() {
  if (b === 123) {
    return "boom";

    if (flower === "rose") {
      return "bloom";
    }

    return "yoyo";
  }
};`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('parenthesized expressions', () => {
  it('1 + (2 + 3) + 4', () => {
    expect(compile('1 + (2 + 3) + 4')).toEqual('1 + (2 + 3) + 4;');
  });

  it('decPart = (decPart + "00").substr(0, 2)', () => {
    expect(compile(
  `decPart = (decPart + "00").substr(0, 2)`)).toEqual(`var decPart = (decPart + "00").substr(0, 2);`);
  });

  it('(params[k] or (params[k] = [])).push v', () => {
    expect(compile(`(params[k] or (params[k] = [])).push v`)).toEqual(`(params[k] || (params[k] = [])).push(v);`);
  });

  it(`foo('bar') unless a && b`, () => {
    const example = `foo('bar') unless a && b`;
    const expected =
`if (!(a && b)) {
  foo("bar");
}`;
    expect(compile(example)).toEqual(expected);
  });

  it(`foo('bar') if !(a && b && !(c && d))`, () => {
    const example = `foo('bar') if !(a && b && !(c && d))`;
    const expected =
`if (!(a && b && !(c && d))) {
  foo("bar");
}`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('assignment expressions', () => {
  it('assigns strings', () => {
    expect(compile('bam = "hello"')).toEqual('var bam = "hello";');
  });

  it(`foo = (one) -> one ||= 'one'`, () => {
    const example = `foo = (one) -> one ||= 'one'`;
    const expected =
`var foo = function(one) {
  return one || (one = "one");
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('@foo = a or b', () => {
    const example = `@foo = a or b`;
    const expected = `this.foo = a || b;`;
    expect(compile(example)).toEqual(expected);
  });

  it('a = b = c = (d) -> a + b + c + d', () => {
    const example = `a = b = c = (d) -> a + b + c + d`;
    const expected =
`var c;
var b;

var a = b = c = function(d) {
  return a + b + c + d;
};`;
    expect(compile(example)).toEqual(expected);
  });

  it(`foo = (one) -> one ?= 'one'`, () => {
    const example = `foo = (one) -> one ?= 'one'`;
    const expected =
`var foo = function(one) {
  return (one != null ? one : one = "one");
};`;
    expect(compile(example)).toEqual(expected);
  });

  it(`(one) -> one ?= 'one'`, () => {
    const example = `(one) -> one ?= 'one'`;
    const expected =
`(function(one) {
  return (one != null ? one : one = "one");
});`;
    expect(compile(example)).toEqual(expected);
  });


  it('shadowed assignments', () => {
    const example =
`a = 'b'
b = ->
  a = 123
  b = ->
    a = 321
    b = a`;
    const expected =
`var a = "b";

var b = function() {
  a = 123;

  return b = function() {
    a = 321;
    return b = a;
  };
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('variable declarations in return statements', () => {
    const example =
`b = ->
  a = 123`;
    const expected =
`var b = function() {
  var a;
  return a = 123;
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('variable declarations in try blocks', () => {
    const example =
`a = 'a'
try
  bom()
catch er
  a = er
  er = 'fooBar'`;
    const expected =
`var a = "a";

try {
  bom();
} catch (er) {
  a = er;
  er = "fooBar";
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('hoists variable declarations in return statements at the top of the body', () => {
    const example =
`4 + b = ->
  c = 'booooo'
  a = 123`;
    const expected =
`var b;

4 + (b = function() {
  var a;
  var c = "booooo";
  return a = 123;
});`;
    expect(compile(example)).toEqual(expected);
  });

  it(`doesn't declare variables twice`, () => {
    const example =
`bam = 'hello'
bam = 'bye'`;

    const expected =
`var bam = "hello";
bam = "bye";`;
    expect(compile(example)).toEqual(expected);
  });

  it('assigns objects', () => {
    const example = 'b = a: 1';
    const expected =
`var b = {
  a: 1
};`;
    expect(compile(example)).toEqual(expected);
  });

  it("declares variables in in class methods if they aren't shadowed by method parameters", () => {
    const example =
`class A extends B
  a: (a) ->
    a = 'boom'

  b: (b = 123) ->

  @c = (c = 'hello') ->
    c + 'world'`;
    const expected =
`class A extends B {
  a(a) {
    return a = "boom";
  }

  b(b = 123) {}

  static c = function(c = "hello") {
    return c + "world";
  };
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('throws an error when super is called in constructor with argument assigments', () => {
    const example =
`class A extends B
  constructor: (@a, @b) ->
    super
    console.log(@a)`;
    expect(compile.bind(this, example)).toThrow();
  });

  it('throws an error when super is called after this assignments', () => {
    const example =
`class A extends B
  constructor: () ->
    @a = 'boom'
    super`;
    expect(compile.bind(this, example)).toThrow();
  });

  it('doesn\'t throw an error when super is called within a method other than constructor', () => {
    const example =
`class A extends B
  b: () ->
    @a = 'boom'
    super`;
    expect(compile.bind(this, example)).toNotThrow();
  });

  it('declares variables in class methods', () => {
    const example =
`class A extends B
  @a: ->
    a = 'boom'

  b: ->
    c = 'yo'

  @c = =>
    d = 'boom'`;
    const expected =
`class A extends B {
  static a() {
    var a;
    return a = "boom";
  }

  b() {
    var c;
    return c = "yo";
  }

  static c = () => {
    var d;
    return d = "boom";
  };
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('declares variables in class methods only when not shadowed', () => {
    const example =
`a = 'hey'
c = 'yo'
class A extends B
  @a: ->
    a = 'boom'
    d = 'bom'

  b: ->
    c = 'yo'

  @c = =>
    d = 'boom'`;
    const expected =
`var a = "hey";
var c = "yo";

class A extends B {
  static a() {
    var d;
    a = "boom";
    return d = "bom";
  }

  b() {
    return c = "yo";
  }

  static c = () => {
    var d;
    return d = "boom";
  };
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('declares variables nested class methods only when not shadowed', () => {
    const example =
`a = 'hey'
c = 'yo'
class A extends B
  @a: ->
    a = 'boom'
    fn = () ->
      a = 'yo'
      e = 'boom'
    d = 'bom'`;
    const expected =
`var a = "hey";
var c = "yo";

class A extends B {
  static a() {
    var d;
    a = "boom";

    var fn = function() {
      var e;
      a = "yo";
      return e = "boom";
    };

    return d = "bom";
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('assigns big objects', () => {
    const example =
`b =
  a: 1,
  c:
    a: 'bom'
    b: 3`;
    const expected =
`var b = {
  a: 1,

  c: {
    a: "bom",
    b: 3
  }
};`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('existential assignment', () => {
  it('handles soaked variable', () => {
    const example = `foo?.bar = "buzz" || ""`;
    const expected = `(foo != null ? foo.bar = "buzz" || "" : void 0);`;
    expect(compile(example)).toEqual(expected);
  });

  it('handles soaked variable property', () => {
    const example = `foo.bar?.car = "qux"`;
    const expected =
`var ref;
((ref = foo.bar) != null ? ref.car = "qux" : void 0);`;
    expect(compile(example)).toEqual(expected);
  });

  it('handles soaked method call', () => {
    const example = `foo.bar()?.car = "qux"`;
    const expected =
`var ref;
((ref = foo.bar()) != null ? ref.car = "qux" : void 0);`;
    expect(compile(example)).toEqual(expected);
  });

  it('handles return-assignments', () => {
    const example =
`bam = ->
  foo?.bar = "buzz"`;

    const expected =
`var bam = function() {
  return (foo != null ? foo.bar = "buzz" : void 0);
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('handles increment-assign', () => {
    const example = `foo.bar?.car += qux`
    const expected =
`var ref;
((ref = foo.bar) != null ? ref.car += qux : void 0);`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('FunctionExpression', () => {
  it('fn = (a,b) -> console.log a, b', () => {
    const example = `fn = (a,b) -> console.log a, b`;
    const expected =
`var fn = function(a, b) {
  return console.log(a, b);
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('fn = (a,b) => console.log a, b', () => {
    const example = `fn = (a,b) => console.log a, b`;
    const expected =
`var fn = (a, b) => {
  return console.log(a, b);
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('fn = (a = 123, b) => console.log a, b', () => {
    const example = `fn = (a = 123, b) => console.log a, b`;
    const expected =
`var fn = (a = 123, b) => {
  return console.log(a, b);
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('fn = (@a = 123, b) => console.log a, b', () => {
    const example = `fn = (@a = 123, b) => console.log a, b`;
    const expected =
`var fn = (a = 123, b) => {
  this.a = a;
  return console.log(a, b);
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('fn = (@a = 123, b) -> console.log a, b', () => {
    const example = `fn = (@a = 123, b) -> console.log a, b`;
    const expected =
`var fn = function(a = 123, b) {
  this.a = a;
  return console.log(a, b);
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('fn = (@a, b) => console.log a, b', () => {
    const example = `fn = (@a, b) => console.log a, b`;
    const expected =
`var fn = (a, b) => {
  this.a = a;
  return console.log(a, b);
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('fn = (@a, b) -> console.log a, b', () => {
    const example = `fn = (@a, b) -> console.log a, b`;
    const expected =
`var fn = function(a, b) {
  this.a = a;
  return console.log(a, b);
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('({@a, @b, c}, @d) => c', () => {
    const example = '({@a, @b, c}, @d) => @a + c';
    const expected =
`(
  {
    a,
    b,
    c
  },
  d) => {
  this.a = a;
  this.b = b;
  this.d = d;
  return this.a + c;
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('turns empty object or array parameter into normal parameter, prevents naming collisions', () => {
    const example = 'fn = ({}, bo, [], ba) ->';
    const expected = `var fn = function(arg, bo, arg1, ba) {};`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('ClassExpression', () => {
  it('renders a simple class expression', () => {
    const example = `class A`;
    const expected = `class A {}`;
    expect(compile(example)).toEqual(expected);
  });

  it('renders class declarations with MemberExpressions as class names', () => {
    const example = `class Cool.Neat.Boom`;
    const expected = `Cool.Neat.Boom = class Boom {};`;
    expect(compile(example)).toEqual(expected);
  });

  it('static assignments with colon are handled equally', () => {
    const example =
`class Store
  @a = 'A'
  @b: 'B'
`;

    const expected =
`class Store {
  static a = "A";
  static b = "B";
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('can compile unnamed class expressions', () => {
    const example =
`class extends Parent
  boom: ->`;

    const expected =
`(class extends Parent {
  boom() {}
});`;
    expect(compile(example)).toEqual(expected);
  });

  it('renders a simple class expression with a method', () => {
    const example =
`class A
  b: -> bom + 123
`;
    const expected =
`class A {
  b() {
    return bom + 123;
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('renders an assignment with a simple class expression with a method', () => {
    const example =
`aClass = class A
  b: -> bom + 123
`;
    const expected =
`var aClass = class A {
  b() {
    return bom + 123;
  }
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('binds fat arrow class methods in the constructor', () => {
    const example =
`aClass = class A
  b: => bom + 123
`;
    const expected =
`var aClass = class A {
  constructor() {
    this.b = this.b.bind(this);
  }

  b() {
    return bom + 123;
  }
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('binds fat arrow methods before the constructor body', () => {
    const example =
`class A
  constructor: ->
    super
    document.addEventListener("event", this.b)

  b: => bom + 123
`;
    const expected =
`class A {
  constructor() {
    super(...arguments);
    this.b = this.b.bind(this);
    document.addEventListener("event", this.b);
  }

  b() {
    return bom + 123;
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('binds fat arrow methods before the constructor body without super', () => {
    const example =
`class A
  constructor: ->
    document.addEventListener("event", this.b)

  b: => bom + 123
`;
    const expected =
`class A {
  constructor() {
    this.b = this.b.bind(this);
    document.addEventListener("event", this.b);
  }

  b() {
    return bom + 123;
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('extends a class with the extend keyword', () => {
    const example =
`class A extends B
  b: -> bom + 123
`;
    const expected =
`class A extends B {
  b() {
    return bom + 123;
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('assigns an extended class to a variable', () => {
    const example =
`a = class A extends B
  b: -> bom + 123
`;
    const expected =
`var a = class A extends B {
  b() {
    return bom + 123;
  }
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('renders class attributes', () => {
    const example =
`class A
  b: [1,2,3,4]
`;
    const expected =
`class A {}
A.prototype.b = [1, 2, 3, 4];`;
    expect(compile(example)).toEqual(expected);
  });

  it('renders class instance fields', () => {
    const example =
`class A
  setup: _.once () ->
  c: () ->
  bam: 123`;
    const expected =
`class A {
  c() {}
}

A.prototype.setup = _.once(function() {});
A.prototype.bam = 123;`;
    expect(compile(example)).toEqual(expected);
  });

  it('renders static class attributes', () => {
    const example =
`class A
  @b = [1,2,3,4]
  c: [1,2,3,4]
`;
    const expected =
`class A {
  static b = [1, 2, 3, 4];
}

A.prototype.c = [1, 2, 3, 4];`;
    expect(compile(example)).toEqual(expected);
  });

  it('static class methods', () => {
    const example =
`class A
  @b: -> say 'hi'
`;
    const expected =
`class A {
  static b() {
    return say("hi");
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('renders bound static class methods exactly the same as normal', () => {
    const example =
`class A
  @b: => say 'hi'
`;
    const expected =
`class A {
  static b() {
    return say("hi");
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('maps @ to this', () => {
    const example =
`class A extends B
  b: -> @bom 1, 2, 'hey'`;

    const expected =
`class A extends B {
  b() {
    return this.bom(1, 2, "hey");
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('doesn\'t automatically add a return statement to a constructor', () => {
    const example =
`class A
  constructor: ->
    a + 'b'`;
    const expected =
`class A {
  constructor() {
    a + "b";
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('inserts return statements into functions inside a constructor', () => {
    const example =
`class A
  constructor: ()->
    fn = (foo)->
      foo = 'foo'
      bar = 'foobar'
      super a + 'b'`;
    const expected =
`class A {
  constructor() {
    var fn = function(foo) {
      foo = "foo";
      var bar = "foobar";
      return super(a + "b");
    };
  }
}`;
    expect(compile(example)).toEqual(expected);
  });


  it('assigns @ arguments to this', () => {
    const example =
`class A
  constructor: (@b) ->`;

    const expected =
`class A {
  constructor(b) {
    this.b = b;
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('assigns @ arguments of classMethods to this', () => {
    const example =
`class A.B
  a: (@b = 'hello there lovely old world') ->`;

    const expected =
`A.B = class B {
  a(b = "hello there lovely old world") {
    this.b = b;
  }
};`;
    expect(compile(example)).toEqual(expected);
  });


  it('assigns @ arguments with default values to this', () => {
    const example =
`class A
  constructor: (@b = 'boom') ->`;

    const expected =
`class A {
  constructor(b = "boom") {
    this.b = b;
  }
}`;
    expect(compile(example)).toEqual(expected);
  });


  describe('super', () => {
    it(`maps super 1 to 1 if in constructor`, () => {
      const example =
`class A
  constructor: ->
    super('boom')
`;
      const expected =
`class A {
  constructor() {
    super("boom");
  }
}`;
      expect(compile(example)).toEqual(expected);
    });

    it(`maps to super.<methodName> if not in constructor`, () => {
      const example =
`class A
  b: ->
    super('boom')
`;
      const expected =
`class A {
  b() {
    return super.b("boom");
  }
}`;
      expect(compile(example)).toEqual(expected);
    });

    it(`maps to super.<methodName> if not in constructor in a bound method`, () => {
      const example =
`class A extends B
  b: =>
    super('boom')
`;
      const expected =
`class A extends B {
  constructor() {
    super(...arguments);
    this.b = this.b.bind(this);
  }

  b() {
    return super.b("boom");
  }
}`;
      expect(compile(example)).toEqual(expected);
    });

    it(`inserts CallExpression with super for ClassExpressions`, () => {
      const example =
`ClassA = class A extends B
  b: =>
    super('boom')
`;
      const expected =
`var ClassA = class A extends B {
  constructor() {
    super(...arguments);
    this.b = this.b.bind(this);
  }

  b() {
    return super.b("boom");
  }
};`;
      expect(compile(example)).toEqual(expected);
    });
  });

  describe('class methods can be called directly', () => {
    it(`Foo::bar()`, () => {
      expect(compile(`Foo::bar()`)).toEqual(`Foo.prototype.bar();`);
    });

    it(`Foo::bar::foo()`, () => {
      expect(compile(`Foo::bar::foo()`)).toEqual(`Foo.prototype.bar.prototype.foo();`);
    });

    it(`Foo?::bar::foo()`, () => {
      expect(compile(`Foo?::bar()`)).toNotBe(
        `((typeof Foo !== "undefined" && Foo !== null ? Foo.prototype.bar.prototype.foo : void 0))();`);
    });
  });
});

describe('extends keyword', () => {
  it.only('extends plain objects', () => {
    const example =
`a = a: 1
b = b: 2
c = a extends b`;
    const expected = ``;
    expect(compile(example)).toEqual(expected);
  });
});

describe('Destructuring', () => {
  it('{a, b} = abam', () => {
    const example = `{a, b} = abam`;
    const expected =
`var {
  a,
  b
} = abam;`;
    expect(compile(example)).toEqual(expected);
  });

  it('{a, b: {c: {d}}} = abam', () => {
    const example = `{a, b: {c: {d}}} = abam`;
    const expected =
`var {
  a,

  b: {
    c: {
      d
    }
  }
} = abam;`;
    expect(compile(example)).toEqual(expected);
  });

  it('{ a } = b\n{ c } = d', () => {
    const example =
`{ a } = b
{ c } = d`;
    const expected =
`var {
  a
} = b;

var {
  c
} = d;`;
    expect(compile(example)).toEqual(expected);
  });

  it('[a, b, c] = abam', () => {
    const example = `[a, b, c] = abam`;
    const expected = `var [a, b, c] = abam;`;
    expect(compile(example)).toEqual(expected);
  });

  it('[a, [b, [c]]] = abam', () => {
    const example = `[a, [b, [c]]] = abam`;
    const expected = `var [a, [b, [c]]] = abam;`;
    expect(compile(example)).toEqual(expected);
  });

  it('[{a: {b: 123}}, b] = bam', () => {
    const example = `[{a: {b: 123}}, b] = bam`;
    const expected =
`var [{
  a: {
    b: 123
  }
}, b] = bam;`;
    expect(compile(example)).toEqual(expected);
  });

  it('{a: [b, c]} = bam', () => {
    const example = `{a: [b, c]} = bam`;
    const expected =
`var {
  a: [b, c]
} = bam;`;
    expect(compile(example)).toEqual(expected);
  });

  it('{@a, @b} = @options', () => {
    const example = `{@a, @b} = @options`;
    const expected =
`var ref;
ref = this.options, this.a = ref.a, this.b = ref.b, ref;`;
    expect(compile(example)).toEqual(expected);
  });

  it('does not declare this members', () => {
    const example = `[@foo, bar] = ['foo', foobar];`;
    const expected =
`var bar;
[this.foo, bar] = ["foo", foobar];`;

    expect(compile(example)).toEqual(expected);
  });

  it('does not generate var declaration when assigning only to members', () => {
    const example = `[@foo, @bar] = ['foo', foobar];`;
    const expected =
`[this.foo, this.bar] = ["foo", foobar];`;

    expect(compile(example)).toEqual(expected);
  });

  it('declares non-member vars outside of conditional assignments', () => {
    const example = `[@currentField, direction, foo] = params.order.split(' ') if params.order`;
    const expected =
`var foo;
var direction;

if (params.order) {
  [this.currentField, direction, foo] = params.order.split(" ");
}`;

    expect(compile(example)).toEqual(expected);
  });

  it('create-assigns in one line if all vars are undeclared', () => {
    const example =
`[a, b] = [1, 2]
setTimeout ->
  a = 4
  b = 5`;

    const expected =
`var [a, b] = [1, 2];

setTimeout(function() {
  a = 4;
  return b = 5;
});`;
    expect(compile(example)).toEqual(expected);
  });

  it('creates undeclared vars and assigns separately if some vars are already in scope', () => {
    const example =
`a = 1;
[a, b] = [1, 2]

setTimeout ->
  a = 4
  b = 5
`;

    const expected =
`var b;
var a = 1;
[a, b] = [1, 2];

setTimeout(function() {
  a = 4;
  return b = 5;
});`;
    expect(compile(example)).toEqual(expected);
  });

  it('allows linters to report undeclared complex objects', () => {
    const example =
`[a, b.c] = [1, 2]
setTimeout ->
  a = 4
  b.c = 5`;

    const expected =
`var a;
[a, b.c] = [1, 2];

setTimeout(function() {
  a = 4;
  return b.c = 5;
});`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('conditional statements', () => {
  it('maps simple if statement', () => {
    const example =
`
if explosion is true
  alert 'BOOM'
`;
    const expected =
`if (explosion === true) {
  alert("BOOM");
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('maps simple if else statement', () => {
    const example =
`
if explosion is true
  alert 'BOOM'
else
  if bom
    alert 'BAM'`;
    const expected =
`if (explosion === true) {
  alert("BOOM");
} else if (bom) {
  alert("BAM");
}`;
    expect(compile(example)).toEqual(expected);
  });


  it('maps nested if statements ', () => {
    const example =
`
if explosion is true
  if fake isnt false
    alert 'BOOM'
`;
    const expected =
`if (explosion === true) {
  if (fake !== false) {
    alert("BOOM");
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('maps if statements with multiple conditions ', () => {
    const example =
`if explosion is true and boom is false and other
  alert 'BOOM'
`;
    const expected =
`if (explosion === true && boom === false && other) {
  alert("BOOM");
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('maps if statements with else statements ', () => {
    const example =
`
if explosion is true
  alert 'BOOM'
else if explosion is false
  alert 'NO BOOM 1'
else if explosion is false
  alert 'NO BOOM 2'
else
  alert 'NOTHING'
`;
    const expected =
`if (explosion === true) {
  alert("BOOM");
} else if (explosion === false) {
  alert("NO BOOM 1");
} else if (explosion === false) {
  alert("NO BOOM 2");
} else {
  alert("NOTHING");
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('maps unless statements', () => {
    const example =
`unless explosion is false
  alert 'BOOM'`;
    const expected =
`if (explosion !== false) {
  alert("BOOM");
}`;
    expect(compile(example)).toEqual(expected);
  });

  it(`maps unless includes statements`, () => {
    const example =
`unless foo in list
  bar();
`;

    const expected =
`if (!list.includes(foo)) {
  bar();
}`;
    expect(compile(example)).toEqual(expected);
  });

  it(`maps not includes statements`, () => {
    const example =
`x = ->
  return if foo not in ["a", "b", "c"]
  qux()
`;

    const expected =
`var x = function() {
  if (!["a", "b", "c"].includes(foo)) {
    return;
  }

  return qux();
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('avoids multiple declarations of the same variable', () => {
    const example =
`switch word
  when 'hello'
    a = 'boom'
  else
    a = 'bim'`;
    const expected =
`var a;

switch (word) {
case "hello":
  a = "boom";
  break;
default:
  a = "bim";
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('maps reverse if statements', () => {
    const example = `console.log 'boom' if condition is true`;
    const expected =
`if (condition === true) {
  console.log("boom");
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('maps long reverse if statements', () => {
    const example = `console.log 'boom' if condition is true and bam isnt false`;
    const expected =
`if (condition === true && bam !== false) {
  console.log("boom");
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('shouldn\'t remove any statements', () => {
    const example =
`if true
  console.log 'then'
else if false
  1 + 321
  hello + world
  bom()
else
  console.log 'else1'
  console.log 'else2'`;
    const expected =
`if (true) {
  console.log("then");
} else if (false) {
  1 + 321;
  hello + world;
  bom();
} else {
  console.log("else1");
  console.log("else2");
}`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('try catch statements', () => {
  it('maps a simple try catch block', () => {
    const example =
`try
  boom()
catch err
  console.log 'error'
`;
    const expected =
`try {
  boom();
} catch (err) {
  console.log("error");
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('long winded single line try statement with assignment', () => {
    const example = `try [[], name, context] = expression.match(/\s*['"](.*?)['"](?:,\s*(.*))?\s*/)`;
    const expected =
`try {
  var [[], name, context] = expression.match(/s*['"](.*?)['"](?:,s*(.*))?s*/);
} finally {}`;
    expect(compile(example)).toEqual(expected);
  });

  it('maps a simple try catch block', () => {
    const example =
`try
  boom()
catch err
  bam = 'boofar'
  console.log 'boom'`;
    const expected =
`try {
  boom();
} catch (err) {
  var bam = "boofar";
  console.log("boom");
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('maps a try catch finally block', () => {
    const example =
`try
  boom()
catch err
  console.log 'error'
finally
  say 'finally'
`;
    const expected =
`try {
  boom();
} catch (err) {
  console.log("error");
} finally {
  say("finally");
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('maps try expressions', () => {
    const example = `x = try y()`;
    const expected =
`var x = (() => {
  try {
    return y();
  } finally {}
})();`;
    expect(compile(example)).toEqual(expected);
  });

  it('inserts return statement for nested expressions', () => {
    const example =
`word = 'boom'
x = try
  a = switch word
    when 'hello' then 'bye'
    else 'whatever'

  a + ' boo'`;
    const expected =
`var word = "boom";

var x = (() => {
  try {
    var a = (() => {
      switch (word) {
      case "hello":
        return "bye";
      default:
        return "whatever";
      }
    })();

    return a + " boo";
  } finally {}
})();`;
    expect(compile(example)).toEqual(expected);
  });

  it('inserts try return statement when last function statement', () => {
    const example =
`x = () ->
  try
    foo()
  finally
    bar()`;

    const expected =
`var x = function() {
  try {
    return foo();
  } finally {
    bar();
  }
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('inserts catch return statement when last function statement', () => {
    const example =
`x = () ->
  try
    foo()
  catch e
    bar()`;

    const expected =
`var x = function() {
  try {
    return foo();
  } catch (e) {
    return bar();
  }
};`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('switch blocks', () => {
  it('prints a simple switch statement', () => {
    const example =
`switch word
  when 'hello' then say 'hello'
  when 'bye' then say 'bye'
  else say 'whatever'`;
    const expected =
`switch (word) {
case "hello":
  say("hello");
  break;
case "bye":
  say("bye");
  break;
default:
  say("whatever");
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('with double cases', () => {
    const example =
`switch name
  when 'joe', 'anne' then say 'hi'`;
    const expected =
`switch (name) {
case "joe":
case "anne":
  say("hi");
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('can produce a switch statement without a subject of undefined', () => {
    const example =
`switch
  when true
    1
  when 'boom'
    2
  else
    3`;
    const expected =
`switch (false) {
case !true:
  1;
  break;
case !"boom":
  2;
  break;
default:
  3;
}`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('switch expressions', () => {
  it('prints a simple switch statement with return statements', () => {
    const example =
`thing = switch word
  when 'hello'
      fray 'boom'
      say 'hello'
  when 'bye' then say 'bye'
  else say 'whatever'`;
    const expected =
`var thing = (() => {
  switch (word) {
  case "hello":
    fray("boom");
    return say("hello");
  case "bye":
    return say("bye");
  default:
    return say("whatever");
  }
})();`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('comprehensions', () => {
  it('simple for loop', () => {
    const example =
`for food in ['toast', 'cheese', 'wine']
  eat food`;
    const expected =
`for (var food of ["toast", "cheese", "wine"]) {
  eat(food);
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('a(b) for [a, b] in c', () => {
    const expected =
`for (var [a, b] of c) {
  a(b);
}`;
    expect(compile('a(b) for [a, b] in c')).toEqual(expected);
  });

  it('a(b) for {a, b} in c', () => {
    const expected =
`for (var {
  a,
  b
} of c) {
  a(b);
}`;
    expect(compile('a(b) for {a, b} in c')).toEqual(expected);
  });


  it('say key, value for key, value of {a: 1}', () => {
    const example =
`say key, value for key, value of {a: 1}`;
    const expected =
`for (var [key, value] of Object.entries({
  a: 1
})) {
  say(key, value);
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('say key for key, value of {a: 1}', () => {
    const example =
`say key for key of {a: 1}`;
    const expected =
`for (var key of Object.keys({
  a: 1
})) {
  say(key);
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('for comprehension assigned with assignment', () => {
    const example =
`res = for food in ['toast', 'cheese', 'wine']
  eat food`;
    const expected =
`var res = ["toast", "cheese", "wine"].map(food => {
  return eat(food);
});`;
    expect(compile(example)).toEqual(expected);
  });

  it('bam = (x for x in [0...10] by 2)', () => {
    const example = `bam = (x for x in [0...10] by 2)`;
    const expected =
`var bam = ([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((_, _i) => {
  return _i === 0 || _i % (2 + 1) === 0;
}).map(x => {
  return x;
}));`;
    expect(compile(example)).toEqual(expected);
  });

  it('bam = (x for x in [0...10] by 4)', () => {
    const example = `bam = (x for x in [0...10] by 4)`;
    const expected =
`var bam = ([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((_, _i) => {
  return _i === 0 || _i % (4 + 1) === 0;
}).map(x => {
  return x;
}));`;
    expect(compile(example)).toEqual(expected);
  });

  it('bam = (x for x in [0...10] by num())', () => {
    const example = `bam = (x for x in [0...10] by num())`;
    const expected =
`var bam = ([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((_, _i) => {
  return _i === 0 || _i % (num() + 1) === 0;
}).map(x => {
  return x;
}));`;
    expect(compile(example)).toEqual(expected);
  });

  it(`"b" of a`, () => {
    const example = `"b" of a`;
    const expected = `"b" in a;`;
    expect(compile(example)).toEqual(expected);
  });

  it('for loop in class method with MemberExpression name', () => {
    const example =
`class A.B
  c: ->
    for d in [0..e]
      d`;
    const expected =
`A.B = class B {
  c() {
    return (() => {
      for (var d of (function() {
          var results = [];

          for (var i = 0; (0 <= e ? i <= e : i >= e); (0 <= e ? i++ : i--)) {
              results.push(i);
          }

          return results;
      }).apply(this)) {
        d;
      }
    })();
  }
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('(c(a) for a, c of b).sort()', () => {
    const example = `(c(a) for a, c of b).sort()`;
    const expected =
`(Object.entries(b).map(([a, c]) => {
  return c(a);
})).sort();`;
    expect(compile(example)).toEqual(expected);
  });

  it('(a for a of b).sort()', () => {
    const example = `(a for a of b).sort()`;
    const expected =
`(Object.keys(b).map(a => {
  return a;
})).sort();`;
    expect(compile(example)).toEqual(expected);
  });

  it('a(b) for a, b in c', () => {
    const example = `a(b) for a, b in c`;
    const expected =
`for (var [b, a] of c.entries()) {
  a(b);
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('a for [0..1]', () => {
    const example = `a for [0..1]`;
    const expected =
`for (var _i of [0, 1]) {
  a;
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('b = (a for [0..1])', () => {
    const example = `b = (a for [0..1])`;
    const expected =
`var b = ([0, 1].map(() => {
  return a;
}));`;
    expect(compile(example)).toEqual(expected);
  });

  it(`a = (1 for b, c in awesome)`, () => {
    const example = `a = (1 for b, c in awesome)`;
    const expected =
`var a = (awesome.map((b, c) => {
  return 1;
}));`;
    expect(compile(example)).toEqual(expected);
  });

  it(`1 for a, b in c.slice(1)`, () => {
    const example = `1 for a, b in c.slice(1)`;
    const expected =
`for (var [b, a] of c.slice(1).entries()) {
  1;
}`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('for loops with conditional', () => {
  it('boom() for i in items when not false', () => {
    const example = 'boom() for i in items when not false';
    const expected =
`for (var i of items) {
  if (!false) {
    boom();
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('for i in items when not false \n boom() ', () => {
    const example =
`for i in items when not false
  boom()
`;
    const expected =
`for (var i of items) {
  if (!false) {
    boom();
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('handles truthy existential property', () => {
    const example = `loopAction(value) for value in values when value?`;

    const expected =
`for (var value of values) {
  if (typeof value !== "undefined" && value !== null) {
    loopAction(value);
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('handles truthy member property', () => {
    const example =
`for value in values when foo.bar
  loopAction(value);
`;

    const expected =
`for (var value of values) {
  if (foo.bar) {
    loopAction(value);
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('handles existential truthy member property', () => {
    const example =
`for value in values when foo.bar?.qux
  loopAction(value)
`;

    const expected =
`var ref;

for (var value of values) {
  if ((ref = foo.bar) != null ? ref.qux : void 0) {
    loopAction(value);
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('handles conditional call', () => {
    const example = `loopAction(value) for value in values when foo?()`;

    const expected =
`for (var value of values) {
  if (typeof foo === "function" ? foo() : void 0) {
    loopAction(value);
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('handles member conditional call', () => {
    const example = `loopAction(value) for value in values when foo?.bar?.qux?()`;
    /* eslint-disable max-len */
    const expected =
`var ref;

for (var value of values) {
  if (typeof foo !== "undefined" && foo !== null ? ((ref = foo.bar) != null ? (typeof ref.qux === "function" ? ref.qux() : void 0) : void 0) : void 0) {
    loopAction(value);
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('handles existential logical expression', () => {
    const example =
`for value in values when regex?.test(foo.bar) || regex.test(bar.foo)
  loopAction(value);
`;

    const expected =
`for (var value of values) {
  if (((typeof regex !== "undefined" && regex !== null ? regex.test(foo.bar) : void 0)) || regex.test(bar.foo)) {
    loopAction(value);
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('isnt with conditional member access', () => {
    const example =
`for value in values when foo.bar?[value] isnt bar[value]
  return loopAction(value);
`;

    const expected =
`var ref;

for (var value of values) {
  if ((((ref = foo.bar) != null ? ref[value] : void 0)) !== bar[value]) {
    return loopAction(value);
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('instanceof', () => {
    const example =
`for value in values when value instanceof Foo
  loopAction(value)
`;

    const expected =
`for (var value of values) {
  if (value instanceof Foo) {
    loopAction(value);
  }
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('assigns conditional loop result using array filter', () => {
    const example = 'results = (item for item in items when item.code[0..1] == expected)';
    const expected =
`var results = (items.filter(item => item.code.slice(0, 2) === expected));`;
    expect(compile(example)).toEqual(expected);
  });

  it('transform-and-assigns conditional loop result using array filter-and-map', () => {
    const example = 'results = (item.name for item in items when item == expected)';
    const expected =
`var results = (items.filter(item => item === expected).map(item => {
  return item.name;
}));`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('ranges', () => {
  it('[1...10]', () => {
    const example = `[1...10]`;
    const expected = `[1, 2, 3, 4, 5, 6, 7, 8, 9];`;

    expect(compile(example)).toEqual(expected);
  });

  it('[1...bom]', () => {
    const example = `[1...bom]`;
    const expected =
`(function() {
    var results = [];

    for (var i = 1; (1 <= bom ? i < bom : i > bom); (1 <= bom ? i++ : i--)) {
        results.push(i);
    }

    return results;
}).apply(this);`;

    expect(compile(example)).toEqual(expected);
  });

  it(`[ 0 .. 15 ].join(',')`, () => {
    const example = `[ 0 .. 15 ].join(',')`;
    expect(compile(example)).toEqual(`[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].join(",");`);
  });
});

describe('splats', () => {
  it('a = c(b...)', () => {
    const example = `a = c(b...)`;
    const expected = `var a = c(...b);`;
    expect(compile(example)).toEqual(expected);
  });

  it('fn = (b...)->', () => {
    const example = `fn = (b...) ->`;
    const expected = `var fn = function(...b) {};`;
    expect(compile(example)).toEqual(expected);
  });

  it('a = [b...]', () => {
    const example = `a = [b...]`;
    const expected = `var a = [...b];`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('destructuring arguments', () => {
  it('({a}) => a', () => {
    const example = `({a}) => a`;
    const expected =
`(
  {
    a
  }) => {
  return a;
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('({a, b, c}) => a', () => {
    const example = `({a, b, c}) => a + b + c`;
    const expected =
`(
  {
    a,
    b,
    c
  }) => {
  return a + b + c;
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('([a, b, c]) => a', () => {
    const example = `([a, b, c]) => a + b + c`;
    const expected =
`([a, b, c]) => {
  return a + b + c;
};`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('argument splats', () => {
  it('fn = (first, ..., beforeLast, last) ->', () => {
    const example = `fn = (first, ..., beforeLast, last) ->`;
    const expected =
`var fn = function(first, ...args) {
  var [beforeLast, last] = args.splice(Math.max(0, args.length - 2));
};`;
    expect(compile(example)).toEqual(expected);
  });

  it(`fn = (@first = 'sobo', ..., @beforeLast = 'boom', last = bom()) ->`, () => {
    const example = `fn = (@first = 'sobo', ..., @beforeLast = 'boom', last = bom()) ->`;
    const expected =
`var fn = function(first = "sobo", ...args) {
  var [beforeLast="boom", last=bom()] = args.splice(Math.max(0, args.length - 2));
  this.first = first;
  this.beforeLast = beforeLast;
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('fn = (first, rest..., last) ->', () => {
    const example = `fn = (first, rest..., last) ->`;
    const expected =
`var fn = function(first, ...rest) {
  var [last] = rest.splice(Math.max(0, rest.length - 1));
};`;
    expect(compile(example)).toEqual(expected);
  });

  it('fn = (first, @rest..., last) ->', () => {
    const example = `fn = (first, @rest..., last) ->`;
    const expected =
`var fn = function(first, ...rest) {
  var [last] = rest.splice(Math.max(0, rest.length - 1));
  this.rest = rest;
};`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('slices', () => {
  it('bam[1...10]', () => {
    const example = `bam[1...10]`;
    const expected = `bam.slice(1, 10);`;
    expect(compile(example)).toEqual(expected);
  });

  it('bam[1...-1]', () => {
    const example = `bam[1...-1]`;
    const expected = `bam.slice(1, -1);`;
    expect(compile(example)).toEqual(expected);
  });

  it('bam[a()...b()]', () => {
    const example = `bam[a()...b()]`;
    const expected = `bam.slice(a(), b());`;
    expect(compile(example)).toEqual(expected);
  });

  it(`bam[a['foobar'].bom...100]`, () => {
    const example = `bam[a["foobar"].bom...100]`;
    const expected = `bam.slice(a["foobar"].bom, 100);`;
    expect(compile(example)).toEqual(expected);
  });

  it('bam[1..10]', () => {
    const example = `bam[1..10]`;
    const expected = `bam.slice(1, 11);`;
    expect(compile(example)).toEqual(expected);
  });

  it('bam[1..10.5]', () => {
    const example = `bam[1..10.5]`;
    const expected = `bam.slice(1, +10.5 + 1 || 9e9);`;
    expect(compile(example)).toEqual(expected);
  });

  it('bam[a()..b()]', () => {
    const example = `bam[a()..b()]`;
    const expected = `bam.slice(a(), +b() + 1 || 9e9);`;
    expect(compile(example)).toEqual(expected);
  });

  it('bam[1..]', () => {
    const example = `bam[1..]`;
    const expected = `bam.slice(1);`;
    expect(compile(example)).toEqual(expected);
  });

  it('bam[..1]', () => {
    const example = `bam[..1]`;
    const expected = `bam.slice(0, 2);`;
    expect(compile(example)).toEqual(expected);
  });

  it('bam[..]', () => {
    const example = `bam[..]`;
    const expected = `bam.slice(0);`;
    expect(compile(example)).toEqual(expected);
  });

  it('bam[foo..-1]', () => {
    const example = `bam[foo..-1]`;
    const expected = `bam.slice(foo);`;
    expect(compile(example)).toEqual(expected);
  });

  it('bam[foo..-2]', () => {
    const example = `bam[foo..-2]`;
    const expected = `bam.slice(foo, -1);`;
    expect(compile(example)).toEqual(expected);
  });

  it('bam[-2..]', () => {
    const example = `bam[-2..]`;
    const expected = `bam.slice(-2);`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('conditional expressions', () => {
  it(`foo = if bar is true then 12345 else 54321`, () => {
    const example = `foo = if bar is true then 12345 else 54321`;
    const expected = `var foo = (bar === true ? 12345 : 54321);`;
    expect(compile(example)).toEqual(expected);
  });

  it(`loop break if rand isnt ord`, () => {
    const expected =
`while (true) {
  if (rand !== ord) {
    break;
  }
}`;
    expect(compile(`loop break if rand isnt ord`)).toEqual(expected);
  });

  //  it.only(`a ? b`, () => {
  //    expect(compile(`a ? b'`)).toEqual(``);
  //  });

  it(`loop continue if rand isnt ord`, () => {
    const expected =
`while (true) {
  if (rand !== ord) {
    continue;
  }
}`;
    expect(compile(`loop continue if rand isnt ord`)).toEqual(expected);
  });

  it(`nested while loops`, () => {
    const expected =
`if (rand !== ord) {
  while (true) {
    while (true) {
      say("hi");
    }
  }
}`;
    expect(compile(`loop loop say 'hi' if rand isnt ord`)).toEqual(expected);
  });

  it(`for in while loop`, () => {
    const expected =
`if (rand !== ord) {
  while (true) {
    for (var a of c) {
      say("hi");
    }
  }
}`;
    expect(compile(`loop say 'hi' for a in c if rand isnt ord`)).toEqual(expected);
  });


  it(`console.log "boom" if "a" of b`, () => {
    const example = `console.log "boom" if "a" of b`;
    const expected =
`if ("a" in b) {
  console.log("boom");
}`;
    expect(compile(example)).toEqual(expected);
  });

  it(`foo = if bar is true then 12345 else if hello is 'world' then 'boom'`, () => {
    const example = `foo = if bar is true then 12345 else if hello is 'world' then 'boom'`;
    const expected =
`var foo = (() => {
  if (bar === true) {
    return 12345;
  } else if (hello === "world") {
    return "boom";
  }
})();`;
    expect(compile(example)).toEqual(expected);
  });

  it(`foo = if bar is true then 12345 else if hello is 'world' then 'boom' else 'bam'`, () => {
    const example = `foo = if bar is true then 12345 else if hello is 'world' then 'boom' else 'bam'`;
    const expected =
`var foo = (() => {
  if (bar === true) {
    return 12345;
  } else if (hello === "world") {
    return "boom";
  } else {
    return "bam";
  }
})();`;
    expect(compile(example)).toEqual(expected);
  });

  it(`nested if expressions`, () => {
    const example =
`b =
  if a is 'loo'
    'boom'
  else
    if boom() is 2
      abc = 'bom' + 123
      abc`;
    const expected =
`var b = (() => {
  var abc;

  if (a === "loo") {
    return "boom";
  } else if (boom() === 2) {
    abc = "bom" + 123;
    return abc;
  }
})();`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('return statements', () => {
  it('switch expression', () => {
    const example =
`a = switch a
  when 'b' then 'c'
  when 'c'
    c = b if c is 'd'`;
    const expected =
`var a = (() => {
  var c;

  switch (a) {
  case "b":
    return "c";
  case "c":
    if (c === "d") {
      return c = b;
    }
  }
})();`;
    expect(compile(example)).toEqual(expected);
  });

  it('switch expression inside conditional', () => {
    const example =
`a =
  unless b is true
    switch a
      when 'b' then 'c'
      when 'c'
        c = b if c is 'd'`;
    const expected =
`var a = (() => {
  var c;

  if (b !== true) {
    switch (a) {
    case "b":
      return "c";
    case "c":
      if (c === "d") {
        return c = b;
      }
    }
  }
})();`;
    expect(compile(example)).toEqual(expected);
  });

  it('switch statement inside conditional (not last statement)', () => {
    const example =
`a =
  unless b is true
    switch a
      when 'b' then 'c'
      when 'c'
        if c is "d"
          c = b;
    123`;

    const expected =
`var a = (() => {
  var c;

  if (b !== true) {
    switch (a) {
    case "b":
      "c";
      break;
    case "c":
      if (c === "d") {
        c = b;
      }
    }

    return 123;
  }
})();`;

    expect(compile(example)).toEqual(expected);
  });
});

describe('while loops', () => {
  it(`console.log 'boom' while i++ < 10`, () => {
    const example = `console.log 'boom' while i++ < 10`;
    const expected =
`while (i++ < 10) {
  console.log("boom");
}`;

    expect(compile(example)).toEqual(expected);
  });

  it(`while loop with block`, () => {
    const example =
`while boom.length
    say 'hi'`;
    const expected =
`while (boom.length) {
  say("hi");
}`;

    expect(compile(example)).toEqual(expected);
  });

  it('say "boom" while (line = lines.shift()) isnt undefined', () => {
    const example = `say "boom" while (line = lines.shift()) isnt undefined`;
    const expected =
`var line;

while ((line = lines.shift()) !== undefined) {
  say("boom");
}`;
    expect(compile(example)).toEqual(expected);
  });

  it('while expressions', () => {
    const example =
`names = while a.length > 0
  a.shift()`;
    const expected =
`var names = (function() {
  var results;
  results = [];

  while (a.length > 0) {
    results.push(a.shift());
  }

  return results;
})();`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('anonymous class', () => {
  it('uses coffeescript compiler', () => {
    const expected =
`var a = (function() {
  function _Class() {}
  return _Class;
})();`;

    expect(compile(`a = class`)).toEqual(expected);
  });
});

describe('MemberExpressions', () => {
  it('one[two]', () => {
    expect(compile('one[two]')).toEqual('one[two];');
  });

  it('one.two', () => {
    expect(compile('one.two')).toEqual('one.two;');
  });

  it('one[two.three]', () => {
    expect(compile('one[two.three]')).toEqual('one[two.three];');
  });

  it('one[two[three]]', () => {
    expect(compile('one[two[three]]')).toEqual('one[two[three]];');
  });

  it('one.two[three.four[five]]', () => {
    expect(compile('one.two[three.four[five]]')).toEqual('one.two[three.four[five]];');
  });

  it('one[two + 2][three.four["five"]]', () => {
    expect(compile('one[two + 2][three.four["five"]]')).toEqual('one[two + 2][three.four["five"]];');
  });
});

describe('block regexes', () => {
  it('simple one line regex', () => {
    expect(compile(`///\+(#{ directives })(.*)///`)).toEqual('RegExp(("+(" + (directives) + ")(.*)"));');
  });
});

describe('call expressions', () => {
  it(`[a, 'b'].join('/')`, () => {
    expect(compile(`[a, 'b'].join('/')`)).toEqual(`[a, "b"].join("/");`);
  });

  it(`a().b().c()`, () => {
    expect(compile(`a().b().c()`)).toEqual(`a().b().c();`);
  });

  it(`(()-> say 'hi')()`, () => {
    const expected =
`(function() {
  return say("hi");
})();`;
    expect(compile(`(()-> say 'hi')()`)).toEqual(expected);
  });
});

describe('extends operator', () => {
  it(`falls back to coffeescript extend utility function`, () => {
    const example = `a extends b`;
    const expected =
`var extend = function(child, parent) {
  for (var key in parent) {
    if (hasProp.call(parent, key)) child[key] = parent[key];
  }
  function ctor() {
    this.constructor = child;
  }
  ctor.prototype = parent.prototype;
  child.prototype = new ctor();
  child.__super__ = parent.prototype;
  return child;
};

var hasProp = {}.hasOwnProperty;
extend(a, b);`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('? operator', () => {
  it('falls back to coffeescript compilation', () => {
    const example = 'a() ? b';
    const expected =
`var ref;
(ref = a()) != null ? ref : b;`;
    expect(compile(example)).toEqual(expected);
  });
});

describe('compound assignments', () => {
  it(`a += 1`, () => {
    expect(compile(`a += 1`)).toEqual(`a += 1;`);
  });

  it(`a &= 1`, () => {
    expect(compile(`a &= 1`)).toEqual(`a &= 1;`);
  });

  it(`a |= 1`, () => {
    expect(compile(`a |= 1`)).toEqual(`a |= 1;`);
  });

  it(`a ^= 1`, () => {
    expect(compile(`a ^= 1`)).toEqual(`a ^= 1;`);
  });

  it(`a /= 1`, () => {
    expect(compile(`a /= 1`)).toEqual(`a /= 1;`);
  });

  it(`a <<= 1`, () => {
    expect(compile(`a <<= 1`)).toEqual(`a <<= 1;`);
  });

  it(`a %= 1`, () => {
    expect(compile(`a %= 1`)).toEqual(`a %= 1;`);
  });

  it(`a *= 1`, () => {
    expect(compile(`a *= 1`)).toEqual(`a *= 1;`);
  });

  it(`a >>= 1`, () => {
    expect(compile(`a >>= 1`)).toEqual(`a >>= 1;`);
  });

  it(`a -= 1`, () => {
    expect(compile(`a -= 1`)).toEqual(`a -= 1;`);
  });

  it(`a >>>= 1`, () => {
    expect(compile(`a >>>= 1`)).toEqual(`a >>>= 1;`);
  });
});

it('Generator functions', () => {
  const example =
`perfectSquares = ->
  num = 0
  loop
    num += 1
    yield num * num

window.ps or= perfectSquares()`;
  const expected =
`var perfectSquares = function*() {
  var num = 0;

  while (true) {
    num += 1;
    yield num * num;
  }
};

window.ps || (window.ps = perfectSquares());`;
  expect(compile(example)).toEqual(expected);
});


describe('prevents naming collision', () => {
  it('if there is already a variable called modulo', () => {
    const example =
`modulo = 123
1 %% 5`;
    const expected =
`var modulo1 = function (a, b) { return (+a % (b = +b) + b) % b; };
var modulo = 123;
modulo1(1, 5);`;
    expect(compile(example)).toEqual(expected);
  });

  it('if we declare a variable called modulo after we use cs modulo', () => {
    const example =
`1 %% 5
modulo = 123`;
    const expected =
`var modulo1 = function (a, b) { return (+a % (b = +b) + b) % b; };
modulo1(1, 5);
var modulo = 123;`;
    expect(compile(example)).toEqual(expected);
  });

  it('if a function parameter is named modulo', () => {
    const example = `(modulo) -> 1 %% 5`;
    const expected =
`var modulo1 = function (a, b) { return (+a % (b = +b) + b) % b; };

(function(modulo) {
  return modulo1(1, 5);
});`;
    expect(compile(example)).toEqual(expected);
  });

  it('if a destructured function parameter is named modulo', () => {
    const example = `({modulo}) -> 1 %% 5`;
    const expected =
`var modulo1 = function (a, b) { return (+a % (b = +b) + b) % b; };

(function(
  {
    modulo
  }) {
  return modulo1(1, 5);
});`;
    expect(compile(example)).toEqual(expected);
  });

  it('if a destructured variable is named modulo', () => {
    const example =
`{a: [b, c, modulo]} = obj
1 %% 5`;
    const expected =
`var modulo1 = function (a, b) { return (+a % (b = +b) + b) % b; };

var {
  a: [b, c, modulo]
} = obj;

modulo1(1, 5);`;
    expect(compile(example)).toEqual(expected);
  });
});
