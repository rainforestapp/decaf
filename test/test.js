import expect from 'expect';
import {compile as _compile, mapLiteral} from '../src/parser';

function compile (source) {
  return _compile(source, {tabWidth: 2}).code;
}

describe('Primitives', ()=> {
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
  });

  it('objects', ()=> {
    expect(compile('a: 213, b: "321"')).toBe('({\n  a: 213,\n  b: "321"\n});');
    expect(compile('false')).toBe('false;');
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

describe('AssigmentExpression', ()=>{
  it('assigns strings', ()=> {
    expect(compile('bam = "hello"')).toBe('var bam = "hello";');
  })

  it(`doesn't declare variables twice`, ()=> {
    const example = 
`bam = 'hello'
bam = 'bye'`

    const expected = 
`var bam = "hello";
bam = "bye";`
    expect(compile(example)).toBe(expected);
  })

  it('assigns objects', ()=> {
    const example = 'b = a: 1';
    const expected = 
`var b = {
  a: 1
};`
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
};`
    expect(compile(example)).toBe(expected);
  });
});

describe('FunctionExpression', ()=> {
  it('renders a simple function expression', ()=> {

    const example = 
`fn = (a,b) -> console.log a, b `

    const expected = 
`var fn = function(a, b) {
  return console.log(a, b);
};`
    expect(compile(example)).toBe(expected);
  });

  it('renders an arrow function expression', ()=> {
    const example = 
`fn = (a,b) => console.log a, b`

    const expected = 
`var fn = (a, b) => {
  return console.log(a, b);
};`
    expect(compile(example)).toBe(expected);
  });

});

describe('ClassExpression', ()=> {
  it('renders a simple class expression', ()=> {
    const example = `class A`
    const expected = `class A {}`
    expect(compile(example)).toBe(expected);
  });

  it('renders a simple class expression with a method', ()=> {
    const example = 
`class A
  b: -> bom + 123
`
    const expected = 
`class A {
  b() {
    return bom + 123;
  }
}`
    expect(compile(example)).toBe(expected);
  });

  it('renders an assignment with a simple class expression with a method', ()=> {
    const example = 
`aClass = class A
  b: -> bom + 123
`
    const expected = 
`var aClass = class A {
  b() {
    return bom + 123;
  }
};`
    expect(compile(example)).toBe(expected);
  });

  it('binds fat arrow class methods in the constructor', ()=> {
    const example = 
`aClass = class A
  b: => bom + 123
`
    const expected = 
`var aClass = class A {
  constructor() {
    this.b.bind(this);
  }

  b() {
    return bom + 123;
  }
};`
    expect(compile(example)).toBe(expected);
  });

  it('extends a class with the extend keyword', ()=> {
    const example = 
`class A extends B
  b: -> bom + 123
`
    const expected = 
`class A extends B {
  b() {
    return bom + 123;
  }
}`
    expect(compile(example)).toBe(expected);
  });

  it('assigns an extended class to a variable', ()=> {
    const example = 
`a = class A extends B
  b: -> bom + 123
`
    const expected = 
`var a = class A extends B {
  b() {
    return bom + 123;
  }
};`
    expect(compile(example)).toBe(expected);
  });

  it('maps @ to this', ()=> {
    const example = 
`class A extends B
  b: -> @bom 1, 2, 'hey'`

    const expected = 
`class A extends B {
  b() {
    return this.bom(1, 2, "hey");
  }
}`
    expect(compile(example)).toBe(expected);
  });
});


describe('Destructuring', ()=> {
  it('maps simple object destructuring assignments', ()=> {
    const example = `{a, b} = abam`;
    const expected = 
`var {
  a,
  b
} = abam;`
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
} = abam;`
    expect(compile(example)).toBe(expected);
  });

  it('maps simple array destructuring assignments', ()=> {
    const example = `[a, b, c] = abam`;
    const expected = `var [a, b, c] = abam;`
    expect(compile(example)).toBe(expected);
  });

  it('maps nested array destructuring assignments', ()=> {
    const example = `[a, [b, [c]]] = abam`;
    const expected = `var [a, [b, [c]]] = abam;`
    expect(compile(example)).toBe(expected);
  });

  it('maps object destructuring assignment inside array destructuring assignment', ()=> {
    const example = `[{a: {b: 123}}, b] = bam`;
    const expected = 
`var [{
  a: {
    b: 123
  }
}, b] = bam;`
    expect(compile(example)).toBe(expected);
  });

  it('maps array destructuring assignment inside object destructuring assignment', ()=> {
    const example = `{a: [b, c]} = bam`;
    const expected = 
`var {
  a: [b, c]
} = bam;`
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
`if (explosion === true) {
  return alert("BOOM");
}`
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
  if (fake !== false) {
    return alert("BOOM");
  }
}`;
    expect(compile(example)).toBe(expected);
  });

  it('maps if statements with multiple conditions ', ()=> {
    const example = 
`
if explosion is true and boom is false and other
  alert 'BOOM'
`;
    const expected = 
`if (explosion === true && boom === false && other) {
  return alert("BOOM");
}`;
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
  return alert("BOOM");
} else if (explosion === false) {
  return alert("NO BOOM 1");
} else if (explosion === false) {
  return alert("NO BOOM 2");
} else {
  return alert("NOTHING");
}`;
    expect(compile(example)).toBe(expected);
  });

  it('maps unless statements', ()=> {
    const example = 
`unless explosion is false
  alert 'BOOM'`;
    const expected = 
`if (explosion !== false) {
  return alert("BOOM");
}`;
    expect(compile(example)).toBe(expected);
  });

  it('maps reverse if statements', ()=> {
    const example = 
`console.log 'boom' if condition is true`;
    const expected = 
`if (condition === true) {
  return console.log("boom");
}`;
    expect(compile(example)).toBe(expected);
  });

  it('maps long reverse if statements', ()=> {
    const example = 
`console.log 'boom' if condition is true and bam isnt false`;
    const expected = 
`if (condition === true && bam !== false) {
  return console.log("boom");
}`;
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
  return boom();
} catch (err) {
  return console.log("error");
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
  return boom();
} catch (err) {
  return console.log("error");
} finally {
  return say("finally");
}`;
    expect(compile(example)).toBe(expected);
  });
});

describe('array comprehensions', ()=> {
  it('should convert in expressions with arrays to includes', ()=> {
  });
});
