import expect from 'expect';
import {compile as _compile} from '../src/parser';

function compile(source) {
  return _compile(source, {tabWidth: 2}).code;
}

describe('Values', ()=> {
  it('strings', ()=> {
    expect(compile('"yoyoyo"')).toBe('"yoyoyo";');
  });

  it('numbers', ()=> {
    expect(compile('123')).toBe('123;');
  });

  it('floats', ()=> {
    expect(compile('123.12353443')).toBe('123.12353443;');
  });

  it('regular expressions', ()=> {
    expect(compile('/gorigori/gi')).toBe('/gorigori/gi;');
  });

  it('NaN', ()=> {
    expect(compile('NaN')).toBe('NaN;');
  });

  it('booleans', ()=> {
    expect(compile('true')).toBe('true;');
    expect(compile('false')).toBe('false;');
    expect(compile('yes')).toBe('true;');
    expect(compile('!!yes')).toBe('!!true;');
    expect(compile('!!!yes')).toBe('!!!true;');
    expect(compile('no')).toBe('false;');
  });

  it('arrays', ()=> {
    expect(compile('[1, 2, 3]')).toBe('[1, 2, 3];');
  });

  it('objects', ()=> {
    expect(compile('a: 213, b: "321"')).toBe('({\n  a: 213,\n  b: "321"\n});');
    expect(compile('false')).toBe('false;');
  });


  it('undefined', ()=> {
    expect(compile('undefined')).toBe('undefined;');
  });

  it('null', ()=> {
    expect(compile('null')).toBe('null;');
  });
});

describe('Unary Expressions', () => {
  it('correctly converts', ()=> {
    expect(compile('-boom')).toBe('-boom;');
    expect(compile('+boom')).toBe('+boom;');
    expect(compile('+boom')).toBe('+boom;');
    expect(compile('num++')).toBe('num++;');
    expect(compile('num--')).toBe('num--;');
    expect(compile('--num')).toBe('--num;');
    expect(compile('++num')).toBe('++num;');
  })
});

describe('new Expressions', ()=> {
  it('new FooBar', ()=> {
    expect(compile('new FooBar')).toBe('new FooBar();');
  });

  it(`new FooBar('bobo')`, ()=> {
    expect(compile(`new FooBar('bobo')`)).toBe(`new FooBar("bobo");`);
  });


  it('bom = new FooBar', ()=> {
    expect(compile('bom = new FooBar')).toBe('var bom = new FooBar();');
  });

  it('bom = new FooBar(1,2,boom())', ()=> {
    expect(compile('bom = new FooBar(1,2,boom())')).toBe('var bom = new FooBar(1, 2, boom());');
  });
});

describe('Existential Operator', ()=> {
  it('foo?', ()=> {
    const example = 'foo?';
    const expected = 'typeof foo !== "undefined" && foo !== null;';
    expect(compile(example)).toBe(expected);
  });

  it('foo?.bar?', ()=> {
    const example = 'foo?.bar?';
    const expected = '((typeof foo !== "undefined" && foo !== null ? foo.bar : void 0)) != null;';
    expect(compile(example)).toBe(expected);
  });

  it('yo = foo?.bar?', ()=> {
    const example = 'yo = foo?.bar?';
    const expected = `var yo = ((typeof foo !== "undefined" && foo !== null ? foo.bar : void 0)) != null;`;
    expect(compile(example)).toBe(expected);
  });

  it('yo = foo?.bar?()', ()=> {
    const example = 'yo = a?.b?.c?()';
    const expected =
`var ref;
var yo = (typeof a !== "undefined" && a !== null ? ((ref = a.b) != null ? (typeof ref.c === "function" ? ref.c() : void 0) : void 0) : void 0);`;
    expect(compile(example)).toBe(expected);
  });
});

describe('Boolean Expression', ()=> {
  it('a > 123', ()=> {
    expect(compile('a > 123')).toBe('a > 123;');
  });

  it('a < 123', ()=> {
    expect(compile('a < 123')).toBe('a < 123;');
  });

  it('a <= 123', ()=> {
    expect(compile('a <= 123')).toBe('a <= 123;');
  });

  it('a >= 123', ()=> {
    expect(compile('a >= 123')).toBe('a >= 123;');
  });

  it('a || 123', ()=> {
    expect(compile('a || 123')).toBe('a || 123;');
  });

  it('a or 123', ()=> {
    expect(compile('a or 123')).toBe('a || 123;');
  });

  it('a and b', ()=> {
    expect(compile('a and b')).toBe('a && b;');
  });

  it('!b', ()=> {
    expect(compile('!b')).toBe('!b;');
  });

  it('!!b', ()=> {
    expect(compile('!!b')).toBe('!!b;');
  });

  it('!!!b', ()=> {
    expect(compile('!!!b')).toBe('!!!b;');
  });

  it(`'hello' in items`, ()=> {
    expect(compile(`'hello' in items`)).toBe(`items.includes("hello");`);
  });
});

describe('embedded javascript', ()=> {
  it('`var b = function(){ console.log(\'foobar\'); }`', ()=> {
    const example = '`var b = function(){ console.log(\'foobar\'); }`';
    const expected = 'var b = function(){ console.log(\'foobar\'); };';
    expect(compile(example)).toBe(expected);
  });
});

describe('assignment expressions', ()=>{
  it('assigns strings', ()=> {
    expect(compile('bam = "hello"')).toBe('var bam = "hello";');
  });

  it(`foo = (one) -> one ||= 'one'`, ()=> {
    const example = `foo = (one) -> one ||= 'one'`;
    const expected =
`var foo = function(one) {
  return one || (one = "one");
};`;
    expect(compile(example)).toBe(expected);
  });

  it('a = b = c = (d) -> a + b + c + d', ()=> {
    const example = `a = b = c = (d) -> a + b + c + d`;
    const expected =
`var c;
var b;

var a = b = c = function(d) {
  return a + b + c + d;
};`
    expect(compile(example)).toBe(expected);
  })

  it(`foo = (one) -> one ?= 'one'`, ()=> {
    const example = `foo = (one) -> one ?= 'one'`;
    const expected =
`var foo = function(one) {
  return (one != null ? one : one = "one");
};`;
    expect(compile(example)).toBe(expected);
  });

  it(`(one) -> one ?= 'one'`, ()=> {
    const example = `(one) -> one ?= 'one'`;
    const expected =
`(function(one) {
  return (one != null ? one : one = "one");
});`;
    expect(compile(example)).toBe(expected);
  });


  it('shadowed assignments', ()=> {
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
    expect(compile(example)).toBe(expected);
  });

  it('variable declarations in return statements', ()=> {
    const example =
`b = ->
  a = 123`;
    const expected =
`var b = function() {
  var a;
  return a = 123;
};`;
    expect(compile(example)).toBe(expected);
  });

  it('hoists variable declarations in return statements at the top of the body', ()=> {
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
    expect(compile(example)).toBe(expected);
  });

  it(`doesn't declare variables twice`, ()=> {
    const example =
`bam = 'hello'
bam = 'bye'`;

    const expected =
`var bam = "hello";
bam = "bye";`;
    expect(compile(example)).toBe(expected);
  });

  it('assigns objects', ()=> {
    const example = 'b = a: 1';
    const expected =
`var b = {
  a: 1
};`;
    expect(compile(example)).toBe(expected);
  });

  it('assigns big objects', ()=> {
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
    expect(compile(example)).toBe(expected);
  });
});

describe('FunctionExpression', ()=> {
  it('fn = (a,b) -> console.log a, b', ()=> {
    const example = `fn = (a,b) -> console.log a, b`;
    const expected =
`var fn = function(a, b) {
  return console.log(a, b);
};`;
    expect(compile(example)).toBe(expected);
  });

  it('fn = (a,b) => console.log a, b', ()=> {
    const example = `fn = (a,b) => console.log a, b`;
    const expected =
`var fn = (a, b) => {
  return console.log(a, b);
};`;
    expect(compile(example)).toBe(expected);
  });

  it('fn = (a = 123, b) => console.log a, b', ()=> {
    const example = `fn = (a = 123, b) => console.log a, b`;
    const expected =
`var fn = (a = 123, b) => {
  return console.log(a, b);
};`;
    expect(compile(example)).toBe(expected);
  });

  it('fn = (@a = 123, b) => console.log a, b', ()=> {
    const example = `fn = (@a = 123, b) => console.log a, b`;
    const expected =
`var fn = (a = 123, b) => {
  this.a = a;
  return console.log(a, b);
};`;
    expect(compile(example)).toBe(expected);
  });

  it('fn = (@a = 123, b) -> console.log a, b', ()=> {
    const example = `fn = (@a = 123, b) -> console.log a, b`;
    const expected =
`var fn = function(a = 123, b) {
  this.a = a;
  return console.log(a, b);
};`;
    expect(compile(example)).toBe(expected);
  });
});

describe('ClassExpression', ()=> {
  it('renders a simple class expression', ()=> {
    const example = `class A`;
    const expected = `class A {}`;
    expect(compile(example)).toBe(expected);
  });

  it('renders a simple class expression with a method', ()=> {
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
    expect(compile(example)).toBe(expected);
  });

  it('renders an assignment with a simple class expression with a method', ()=> {
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
    expect(compile(example)).toBe(expected);
  });

  it('binds fat arrow class methods in the constructor', ()=> {
    const example =
`aClass = class A
  b: => bom + 123
`;
    const expected =
`var aClass = class A {
  constructor() {
    this.b.bind(this);
  }

  b() {
    return bom + 123;
  }
};`;
    expect(compile(example)).toBe(expected);
  });

  it('extends a class with the extend keyword', ()=> {
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
    expect(compile(example)).toBe(expected);
  });

  it('assigns an extended class to a variable', ()=> {
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
    expect(compile(example)).toBe(expected);
  });

  it('maps @ to this', ()=> {
    const example =
`class A extends B
  b: -> @bom 1, 2, 'hey'`;

    const expected =
`class A extends B {
  b() {
    return this.bom(1, 2, "hey");
  }
}`;
    expect(compile(example)).toBe(expected);
  });

  describe('super', ()=> {
    it(`maps super 1 to 1 if in constructor`, ()=> {
      const example =
`class A
  constructor: ->
    super('boom')
`;
      const expected =
`class A {
  constructor() {
    return super("boom");
  }
}`;
      expect(compile(example)).toBe(expected);
    });

    it(`maps to super.<methodName> if not in constructor`, ()=> {
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
      expect(compile(example)).toBe(expected);
    });

    it(`maps to super.<methodName> if not in constructor in a bound method`, ()=> {
      const example =
`class A
  b: =>
    super('boom')
`;
      const expected =
`class A {
  constructor() {
    this.b.bind(this);
  }

  b() {
    return super.b("boom");
  }
}`;
      expect(compile(example)).toBe(expected);
    });
  });

  describe('class methods can be called directly', ()=> {
    it(`Foo::bar()`, ()=> {
      expect(compile(`Foo::bar()`)).toBe(`Foo.prototype.bar();`);
    });

    it(`Foo::bar::foo()`, ()=> {
      expect(compile(`Foo::bar::foo()`)).toBe(`Foo.prototype.bar.prototype.foo();`);
    });

    it(`Foo?::bar::foo()`, ()=> {
      expect(compile(`Foo?::bar()`)).toNotBe(`((typeof Foo !== "undefined" && Foo !== null ? Foo.prototype.bar.prototype.foo : void 0))();`);
    });
  });
});

describe('Destructuring', ()=> {
  it('maps simple object destructuring assignments', ()=> {
    const example = `{a, b} = abam`;
    const expected =
`var {
  a,
  b
} = abam;`;
    expect(compile(example)).toBe(expected);
  });

  it('maps deep object destructuring assignments', ()=> {
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
    expect(compile(example)).toBe(expected);
  });

  it('maps simple array destructuring assignments', ()=> {
    const example = `[a, b, c] = abam`;
    const expected = `var [a, b, c] = abam;`;
    expect(compile(example)).toBe(expected);
  });

  it('maps nested array destructuring assignments', ()=> {
    const example = `[a, [b, [c]]] = abam`;
    const expected = `var [a, [b, [c]]] = abam;`;
    expect(compile(example)).toBe(expected);
  });

  it('maps object destructuring assignment inside array destructuring assignment', ()=> {
    const example = `[{a: {b: 123}}, b] = bam`;
    const expected =
`var [{
  a: {
    b: 123
  }
}, b] = bam;`;
    expect(compile(example)).toBe(expected);
  });

  it('maps array destructuring assignment inside object destructuring assignment', ()=> {
    const example = `{a: [b, c]} = bam`;
    const expected =
`var {
  a: [b, c]
} = bam;`;
    expect(compile(example)).toBe(expected);
  });
});

describe('conditional statements', ()=> {
  it('maps simple if statement', ()=> {
    const example =
`
if explosion is true
  alert 'BOOM'
`;
    const expected =
`(explosion === true ? alert("BOOM") : undefined);`;
    expect(compile(example)).toBe(expected);
  });

  it('maps simple if else statement', ()=> {
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
    expect(compile(example)).toBe(expected);
  });


  it('maps nested if statements ', ()=> {
    const example =
`
if explosion is true
  if fake isnt false
    alert 'BOOM'
`;
    const expected =
`if (explosion === true) {
  (fake !== false ? alert("BOOM") : undefined);
}`;
    expect(compile(example)).toBe(expected);
  });

  it('maps if statements with multiple conditions ', ()=> {
    const example =
`if explosion is true and boom is false and other
  alert 'BOOM'
`;
    const expected = `(explosion === true && boom === false && other ? alert("BOOM") : undefined);`;
    expect(compile(example)).toBe(expected);
  });

  it('maps if statements with else statements ', ()=> {
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
    expect(compile(example)).toBe(expected);
  });

  it('maps unless statements', ()=> {
    const example =
`unless explosion is false
  alert 'BOOM'`;
    const expected = `(explosion !== false ? alert("BOOM") : undefined);`;
    expect(compile(example)).toBe(expected);
  });

  it('maps reverse if statements', ()=> {
    const example = `console.log 'boom' if condition is true`;
    const expected = `(condition === true ? console.log("boom") : undefined);`;
    expect(compile(example)).toBe(expected);
  });

  it('maps long reverse if statements', ()=> {
    const example = `console.log 'boom' if condition is true and bam isnt false`;
    const expected = `(condition === true && bam !== false ? console.log("boom") : undefined);`;
    expect(compile(example)).toBe(expected);
  });
});

describe('try catch statements', ()=> {
  it('maps a simple try catch block', ()=> {
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
    expect(compile(example)).toBe(expected);
  });

  it('maps a try catch finally block', ()=> {
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
    expect(compile(example)).toBe(expected);
  });
});

describe('switch blocks', ()=> {
  it('prints a simple switch statement', ()=> {
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
    expect(compile(example)).toBe(expected);
  });
});

describe('switch expressions', ()=> {
  it('prints a simple switch statement with return statements', ()=> {
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
    expect(compile(example)).toBe(expected);
  });
});

describe('comprehensions', ()=> {
  it('simple for loop', ()=> {
    const example =
`for food in ['toast', 'cheese', 'wine']
  eat food`;
    const expected =
`for (let food in ["toast", "cheese", "wine"]) {
  eat(food);
}`;
    expect(compile(example)).toBe(expected);
  });

  it('for comprehension assigned with assignment', ()=> {
    const example =
`res = for food in ['toast', 'cheese', 'wine']
  eat food`;
    const expected =
`var res = ["toast", "cheese", "wine"].map(food => {
  return eat(food);
});`;
    expect(compile(example)).toBe(expected);
  });

  it('bam = (x for x in [0...10] by 2)', ()=> {
    const example = `bam = (x for x in [0...10] by 2)`;
    const expected =
`var bam = ([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((_, _i) => {
  return _i === 0 || _i % (2 + 1) === 0;
}).map(x => {
  return x;
}));`;
    expect(compile(example)).toBe(expected);
  });

  it('bam = (x for x in [0...10] by 4)', ()=> {
    const example = `bam = (x for x in [0...10] by 4)`;
    const expected =
`var bam = ([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((_, _i) => {
  return _i === 0 || _i % (4 + 1) === 0;
}).map(x => {
  return x;
}));`;
    expect(compile(example)).toBe(expected);
  });

  it('bam = (x for x in [0...10] by num())', ()=> {
    const example = `bam = (x for x in [0...10] by num())`;
    const expected =
`var bam = ([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((_, _i) => {
  return _i === 0 || _i % (num() + 1) === 0;
}).map(x => {
  return x;
}));`;

    expect(compile(example)).toBe(expected);
  });

  it(`"b" of a`, ()=> {
    const example = `"b" of a`;
    const expected = `"b" in a;`;
    expect(compile(example)).toBe(expected)
  });
});

describe('ranges', ()=> {
  it('simple ranges', ()=> {
    const example = `[1...10]`;
    const expected = `[1, 2, 3, 4, 5, 6, 7, 8, 9];`;

    expect(compile(example)).toBe(expected);
  });

  it('uses coffeescript parser for generated ranges', ()=> {
    const example = `[1...bom]`;
    const expected =
`(function() {
  var results = [];

  for (var i = 1; (1 <= bom ? i < bom : i > bom); (1 <= bom ? i++ : i--)) {
    results.push(i);
  }

  return results;
}).apply(this);`;

    expect(compile(example)).toBe(expected);
  });
});

describe('splats', ()=> {
  it('a = c(b...)', ()=> {
    const example = `a = c(b...)`;
    const expected = `var a = c(...b);`;
    expect(compile(example)).toBe(expected);
  });

  it('fn = (b...)->', ()=> {
    const example = `fn = (b...) ->`;
    const expected = `var fn = function(...b) {};`;
    expect(compile(example)).toBe(expected);
  });

  it('a = [b...]', ()=> {
    const example = `a = [b...]`;
    const expected = `var a = [...b];`;
    expect(compile(example)).toBe(expected);
  });
});

describe('argument splats', () =>{
  it('fn = (first, ..., beforeLast, last) ->', ()=> {
    const example = `fn = (first, ..., beforeLast, last) ->`;
    const expected =
`var fn = function() {
  var first = arguments[0];
  var last = arguments[arguments.length - 1];
  var beforeLast = arguments[arguments.length - 2];
};`;
    expect(compile(example)).toBe(expected);
  });

  it(`fn = (@first = 'sobo', ..., beforeLast, last = bom()) ->`, ()=> {
    const example = `fn = (@first = 'sobo', ..., @beforeLast = 'boom', last = bom()) ->`;
    const expected =
`var fn = function() {
  this.first = arguments[0];

  if (arguments[0] === undefined)
    this.first = "sobo";

  var last = arguments[arguments.length - 1];

  if (arguments[arguments.length - 1] === undefined)
    last = bom();

  this.beforeLast = arguments[arguments.length - 2];

  if (arguments[arguments.length - 2] === undefined)
    this.beforeLast = "boom";
};`;
    expect(compile(example)).toBe(expected);
  });

  it('fn = (first, rest..., last) ->', ()=> {
    const example = `fn = (first, rest..., last) ->`;
    const expected =
`var fn = function() {
  var first = arguments[0];
  var rest = arguments.slice(2, arguments[arguments.length - 1]);
  var last = arguments[arguments.length - 1];
};`;
    expect(compile(example)).toBe(expected);
  });

  it('fn = (first, @rest..., last) ->', ()=> {
    const example = `fn = (first, @rest..., last) ->`;
    const expected =
`var fn = function() {
  var first = arguments[0];
  this.rest = arguments.slice(2, arguments[arguments.length - 1]);
  var last = arguments[arguments.length - 1];
};`;
    expect(compile(example)).toBe(expected);
  });
});

describe('slices', ()=> {
  it('bam[1...10]', ()=> {
    const example = `bam[1...10]`;
    const expected = `bam.slice(1, 10);`;
    expect(compile(example)).toBe(expected);
  });

  it('bam[a()...b()]', ()=> {
    const example = `bam[a()...b()]`;
    const expected = `bam.slice(a(), b());`;
    expect(compile(example)).toBe(expected);
  });

  it(`bam[a['foobar'].bom...100]`, ()=> {
    const example = `bam[a['foobar'].bom...100]`;
    const expected = `bam.slice(a["foobar"].bom, 100);`;
    expect(compile(example)).toBe(expected);
  });
});

describe('conditional expressions', ()=> {
  it(`foo = if bar is true then 12345 else 54321`, ()=> {
    const example = `foo = if bar is true then 12345 else 54321`;
    const expected = `var foo = (bar === true ? 12345 : 54321);`;
    expect(compile(example)).toBe(expected);
  });

  it(`console.log "boom" if "a" of b`, ()=> {
    const example = `console.log "boom" if "a" of b`;
    const expected = `("a" in b ? console.log("boom") : undefined);`
    expect(compile(example)).toBe(expected);
  })

  it(`foo = if bar is true then 12345 else if hello is 'world' then 'boom'`, ()=> {
    const example = `foo = if bar is true then 12345 else if hello is 'world' then 'boom'`;
    const expected =
`var foo = (() => {
  if (bar === true) {
    return 12345;
  } else if (hello === "world") {
    return "boom";
  }
})();`;
    expect(compile(example)).toBe(expected);
  });

  it(`foo = if bar is true then 12345 else if hello is 'world' then 'boom' else 'bam'`, ()=> {
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
    expect(compile(example)).toBe(expected);
  });

  it(`nested if expressions`, ()=> {
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
  if (a === "loo") {
    return "boom";
  } else if (boom() === 2) {
    var abc = "bom" + 123;
    return abc;
  }
})();`;
    expect(compile(example)).toBe(expected);
  });
});

describe('return statements', ()=> {
  it('switch expression', ()=> {
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
    return (c === "d" ? c = b : undefined);
  }
})();`;
    expect(compile(example)).toBe(expected);
  });

  it('switch expression inside conditional', ()=> {
    const example =
`a =
  unless b is true
    switch a
      when 'b' then 'c'
      when 'c'
        c = b if c is 'd'`;
    const expected =
`var a = (b !== true ? (() => {
  var c;

  switch (a) {
  case "b":
    return "c";
  case "c":
    return (c === "d" ? c = b : undefined);
  }
})() : undefined);`;
    expect(compile(example)).toBe(expected);
  });

  it('switch statement inside conditional (not last statement)', ()=> {
    const example =
`a =
  unless b is true
    switch a
      when 'b' then 'c'
      when 'c'
        c = b if c is 'd'
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
      (c === "d" ? c = b : undefined);
      break;
    }

    return 123;
  }
})();`;
    expect(compile(example)).toBe(expected);
  });
});

describe('while loops', ()=> {
  it(`console.log 'boom' while i++ < 10`, ()=> {
    const example = `console.log 'boom' while i++ < 10`
    const expected =
`while (i++ < 10) {
  console.log("boom");
}`

    expect(compile(example)).toBe(expected);
  });
});

describe('large code examples', ()=> {
  it('getCursorPosition', ()=> {
    const example = 
String.raw`$ = require 'jquery'

$.fn.serializeForm = ->
  json = {}
  for el in serializeArray($(this))
    json[el.name] = el.value
  json

serializeArray = (el) ->
  inputs = []
  el.find('input, textarea, select').each (i, input) =>
    unless input.disabled
      if $(input).is(':checkbox')
        inputs.push
          name: input.name
          value: $(input).is(':checked')
      else
        val = $(input).val()
        inputs.push
          name: input.name
          value: val

  inputs

(($) ->
  re = /([^&=]+)=?([^&]*)/g
  decodeRE = /\+/g # Regex for replacing addition symbol with a space
  decode = (str) ->
    decodeURIComponent str.replace(decodeRE, " ")

  $.parseParams = (query) ->
    params = {}
    e = undefined
    while e = re.exec(query)
      k = decode(e[1])
      v = decode(e[2])
      if k.substring(k.length - 2) is "[]"
        k = k.substring(0, k.length - 2)
        (params[k] or (params[k] = [])).push v
      else
        params[k] = v
    params
) jQuery
`;
//console.log(compile(example));
// TODO
  });
});
