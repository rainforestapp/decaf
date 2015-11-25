import {namedTypes, builders as b} from 'ast-types';
import recast from 'recast';
import {nodes as coffeeAst} from 'coffee-script';
import _ from 'lodash';

// regexes taken from coffeescript parser
export const IDENTIFIER = /^(?!\d)[$\w\x7f-\uffff]+$/;
export const SIMPLENUM = /^[+-]?\d+$/;
export const HEXNUM = /^[+-]?0x[\da-f]+/i;
export const IS_NUMBER = /^[+-]?(?:0x[\da-f]+|\d*\.?\d+(?:e[+-]?\d+)?)$/i;
export const IS_STRING = /^['"]/;
export const IS_REGEX = /^\//;
export const IS_BOOLEAN = /^(?:(?:true)|(?:false))$/;

export const STRING_INSIDE_QUOTES = /^['"](.*)['"]$/

//const example1 = `
//b = {a: 1}
//{bom, from} = krom
//`;

const example1 = `
{a, c: {b}} = bam
`;

export function mapBoolean(node, scope) {
  if (node.base.val === 'true') {
    return b.literal(true);
  } else if (node.base.val === 'false') {
    return b.literal(false);
  }

  throw new Error(`can't convert node of type: ${node.constructor.name} to boolean - not recognized`);
}

export function stringToRegex(inputstring) {
  var match = inputstring.match(new RegExp('^/(.*?)/([gimy]*)$'));
  return new RegExp(match[1], match[2]);
}

export function mapMemberExpression(properties, scope) {
  const restProperties = properties.slice(0, properties.length-1);
  const right = mapExpression(properties[properties.length-1], scope);
  const computed = right.type === 'Literal';
  let left;

  if (restProperties.length === 1) {
    left = mapExpression(restProperties[0], scope);
  } else {
    left = mapMemberExpression(restProperties, scope);
  }

  return b.memberExpression(left, right, computed);
}

export function mapLiteral(node, scope) {
  let value;
  value = node.base.value;
  const type = node.constructor.name;

  if (value === 'NaN') {
    return b.literal(NaN);
  }else if (IS_STRING.test(value)) {
    return b.literal(value.match(STRING_INSIDE_QUOTES)[1]);
  }else if (IS_NUMBER.test(value)) {
    return b.literal(Number(value));
  }else if (IS_REGEX.test(value)) {
    return b.literal(stringToRegex(value));
  }

  return b.identifier(value);
}

export function mapKey(node, scope) {
  const type = node.base.constructor.name;
  if (type === 'Literal') {
    return b.identifier(node.base.value);
  }
}

export function mapObjectExpression(node, scope) {
  return b.objectExpression(node.base.properties.map((property)=> {
    return b.property(
      'init', 
      mapExpression(property.variable || property.base, scope),
      mapExpression(property.value || property.base, scope));
  }));
}

export function mapValue(node, scope) {
  const type = node.base.constructor.name;
  let literal;

  if (type === 'Literal') {
    return mapLiteral(node, scope);
  } else if (type === 'Bool') {
    return mapBoolean(node, scope);
  } else if (type === 'Obj') {
    return mapObjectExpression(node, scope);
  } else if (type === 'Parens') {
    return b.sequenceExpression(node.base.body.expressions.map((expr) => mapExpression(expr, scope)));
  }

  throw new Error(`can't convert node of type: ${type} to value - not recognized`);
}

export function mapOp(node, scope) {
  const {operator} = node;
  if (operator === '||' || operator === '&&') {
    return b.logicalExpression(node.operator, mapExpression(node.first, scope), mapExpression(node.second, scope));
  }
  return b.binaryExpression(node.operator, mapExpression(node.first, scope), mapExpression(node.second, scope));
}

export function mapArguments(args, scope) {
  return args.map((arg)=> mapExpression(arg, scope));
}

export function mapCall(node, scope) {
  return b.callExpression(mapExpression(node.variable, scope), mapArguments(node.args, scope));
}

export function mapAssignment(node, scope) {
  const identifierName = node.variable.base.value;

  if(scope[identifierName] === undefined && node.variable.properties.length === 0) {
    return mapVariableDeclaration(node, scope);
  }

  return b.expressionStatement(mapExpression(node, scope));
}

export function mapClassBodyElement(node, scope) {
  const {type} = node.constructor.name;
  const methodName = node.variable.base.value;
  let elementType = 'method';

  if(methodName === 'constructor'){
    elementType = 'constructor';
  }

  return b.methodDefinition(elementType, mapExpression(node.variable, scope), mapExpression(node.value, scope));
}

export function getBoundMethodNames(classElements) {
  return classElements.filter((el)=> {
    return el.value.constructor.name === 'Code' &&
      el.value.bound === true;
  }).map(el => mapExpression(el.variable));
}

export function unbindMethods(classElements) {
  return classElements.map((el)=> {
    if(el.value.constructor.name === 'Code') {
      el.value.bound = false;
    }
    return el;
  })
}

export function mapClassBody(node, scope) {
  const {expressions} = node;
  let boundMethods = [];
  let classElements = [];

  if(expressions.length > 0) {
    classElements = node.expressions[0].base.properties;
    boundMethods = getBoundMethodNames(classElements);
    classElements = unbindMethods(classElements);
    classElements = classElements.map( el => mapClassBodyElement(el, scope));
  }

  let constructor = _.findWhere(classElements, {kind: 'constructor'});

  if(boundMethods.length > 0){
    if(constructor === undefined) {
      // create an empty constructor if there isn't one yet
      constructor = b.methodDefinition(
        'constructor', 
        b.identifier('constructor'), 
        b.functionExpression(null, [], b.blockStatement([])));
      classElements.unshift(constructor);
    }

    // bind all the bound methods to the class
    constructor.value.body.body = 
      constructor.value.body.body.concat(
        boundMethods.map((identifier)=> {
          return b.expressionStatement(
            b.callExpression(
              b.memberExpression(
                b.memberExpression(
                  b.thisExpression(),
                  identifier
                ),
                b.identifier('bind')
              ),
              [b.thisExpression()]
            )
          )
        })
    );
  }

  return b.classBody(classElements);

  return null;
}

export function mapClassExpression(node, scope) {
  let parent = null;

  if (node.parent !== undefined && node.parent !== null) {
    parent = mapExpression(node.parent, scope);
  }

  return b.classExpression(
    mapExpression(node.variable, scope),
    mapClassBody(node.body, scope),
    parent
  )
}


export function mapClassDeclaration(node, scope) {
  let parent = null;

  if (node.parent !== undefined && node.parent !== null) {
    parent = mapExpression(node.parent, scope);
  }

  return b.classDeclaration(
    mapExpression(node.variable, scope),
    mapClassBody(node.body, scope),
    parent
  )
}

export function mapStatement(node, scope) {
  const type = node.constructor.name;

  if (type === 'Assign') {
    const identifierName = node.variable.base.value;
    return mapAssignment(node, scope);
  } else if (type === 'Class') {
    return mapClassDeclaration(node, scope);
  }

  return b.expressionStatement(mapExpression(node, scope));

  throw new Error(`can't convert node of type: ${type} to statement - not recognized`);
}

export function mapBlockStatement(node, scope) {
  const lastIndex = node.expressions.length - 1;
  return b.blockStatement(node.expressions.map((expr, i) => {
    if (i === lastIndex) {
      return b.returnStatement(mapExpression(expr, scope));
    }
    return mapStatement(expr, scope);
  }));
}

export function mapFunction(node, scope) {
  let constructor = b.functionExpression;
  const args = mapArguments(node.params, scope);
  const block = mapBlockStatement(node.body, scope);

  if (node.bound === true) {
    return b.arrowFunctionExpression(args, block);
  }

  return b.functionExpression(null, args, block);
}

export function mapExpression(node, scope) {
  //IS_REGEX.test(node.value.base.value)
  const type = node.constructor.name;

  if (node.properties && node.properties.length > 0) {
    return mapMemberExpression([node.base, ...node.properties]);
  } else if (type === 'Assign') {
    return mapAssignmentExpression(node, scope);
  } else if (type === 'Param') {
    return mapExpression(node.name, scope);
  }else if (type === 'Class') {
    return mapClassExpression(node, scope);
  } else if (type === 'Extends') {
    return mapExpression(node.parent, scope);
  } else if (type === 'Code') { // Code is just a stupid word for function
    return mapFunction(node, scope);
  } else if (type === 'Index') {
    return mapExpression(node.index, scope);
  } else if (type === 'Access') {
    return mapExpression(node.name, scope);
  } else if (type === 'Literal'){
    return mapLiteral({base: node}, scope);
  } else if (type === 'Value') {
    return mapValue(node, scope);
  } else if (type === 'Op') {
    return mapOp(node, scope);
  } else if(type === 'Call') {
    return mapCall(node, scope);
  }

  throw new Error(`can't convert node of type: ${type} to Expression - not recognized`);
}

export function mapAssignmentExpression(node, scope) {
  const leftHandType = node.variable.base.constructor.name;
  const identifierName = node.variable.base.value;
  let leftHand;
  
  if (leftHandType === 'Literal') {
    leftHand = b.identifier(identifierName);
  }

  return b.assignmentExpression(
    '=',
    mapExpression(node.variable, scope),
    mapExpression(node.value, scope));
}

export function mapObjectPatternItem(node, scope) {
  const type = node.constructor.name;
  if(type === 'Value') {
    return mapLiteral(node, scope);
  } else if (type === 'Assign') {
    return mapObjectPattern(node.value.base.properties, scope);
  }

  throw new Error(`can't convert node of type: ${type} to ObjectPatternItem - not recognized`);
}


export function mapObjectPattern(nodes, scope) {
  return b.objectPattern(nodes.map((node) => {
    const {operatorToken} = node;
    const {value, variable} = node;
    const type = node.constructor.name;
    let propValue;
    let prop;
    prop = b.property(
      'init',
      mapKey(node.variable || node),
      mapObjectPatternItem(node)
    );

    if(operatorToken === undefined) {
      prop.shorthand = true;
    }
    return prop;
  }));
}

export function mapAssignmentPattern(node, scope) {
  const type = node.constructor.name

  // that's a destructuring assignment
  if (type === 'Value' && 
      node.base.constructor.name === 'Obj' &&
      node.base.properties.length > 0) {
    return mapObjectPattern(node.base.properties, scope);
  }

  return mapExpression(node, scope);
}

export function mapVariableDeclaration(node, scope) {
  const identifierName = node.variable.base.value;
  scope[identifierName] = true;
  return b.variableDeclaration('var', [
    b.variableDeclarator(
      mapAssignmentPattern(node.variable, scope), 
      mapExpression(node.value, scope))]);
}

export function parse(coffeeSource, baseScope={}) {
  const ast = coffeeAst(coffeeSource);
  const body = ast.expressions.map((node) => mapStatement(node, baseScope));
  const program = b.program(body);
  return program;
}

export function compile(coffeeSource, options = {}) {
  return recast.print(parse(coffeeSource), options);
}

process.stdout.write('\nCODE: \n\n' + compile(example1).code + '\n');
