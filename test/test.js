import expect from 'expect';
import {compile as _compile} from '../src/parser';

function compile (source) {
  return _compile(source, {tabWidth: 2}).code;
}

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


});
