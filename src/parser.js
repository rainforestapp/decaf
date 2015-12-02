import {builders as b} from 'ast-types';
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

export const STRING_INSIDE_QUOTES = /^['"](.*)['"]$/;

export function isExpression(node) {
  const type = node.constructor.name;
  if (type === 'If') {
    return false;
  }
  return true;
}

export function mapBoolean(node) {
  if (node.base.val === 'true') {
    return b.literal(true);
  } else if (node.base.val === 'false') {
    return b.literal(false);
  }

  throw new Error(`can't convert node of type: ${node.constructor.name} to boolean - not recognized`);
}

export function stringToRegex(inputstring) {
  const match = inputstring.match(new RegExp('^/(.*?)/([gimy]*)$'));
  return new RegExp(match[1], match[2]);
}

export function mapMemberExpression(properties, meta) {
  const restProperties = properties.slice(0, properties.length - 1);
  const right = mapExpression(properties[properties.length - 1], meta);
  const isComputed = right.type === 'Literal';
  let left;

  if (restProperties.length === 1) {
    left = mapExpression(restProperties[0], meta);
  } else {
    left = mapMemberExpression(restProperties, meta);
  }

  return b.memberExpression(left, right, isComputed);
}

export function mapLiteral(node) {
  let value;
  value = node.base.value;

  if (value === 'NaN') {
    return b.literal(NaN);
  } else if (IS_STRING.test(value)) {
    return b.literal(value.match(STRING_INSIDE_QUOTES)[1]);
  } else if (IS_NUMBER.test(value)) {
    return b.literal(Number(value));
  } else if (IS_REGEX.test(value)) {
    return b.literal(stringToRegex(value));
  }

  return b.identifier(value);
}

export function mapKey(node) {
  const type = node.base.constructor.name;
  if (type === 'Literal') {
    return b.identifier(node.base.value);
  }
}

export function mapObjectExpression(node, meta) {
  return b.objectExpression(node.base.properties.map((property)=> {
    return b.property(
      'init',
      mapExpression(property.variable || property.base, meta),
      mapExpression(property.value || property.base, meta));
  }));
}

export function mapArrayExpression(node, meta) {
  return b.arrayExpression(node.objects.map((expr) => mapExpression(expr, meta)));
}

export function mapValue(node, meta) {
  const type = node.base.constructor.name;

  if (type === 'Literal') {
    return mapLiteral(node, meta);
  } else if (type === 'Bool') {
    return mapBoolean(node, meta);
  } else if (type === 'Arr' && meta.left === true) {
    return mapArrayPattern(node.base, meta);
  } else if (type === 'Arr') {
    return mapArrayExpression(node.base, meta);
  } else if (type === 'Obj') {
    return mapObjectExpression(node, meta);
  } else if (type === 'Parens') {
    return b.sequenceExpression(node.base.body.expressions.map((expr) => mapExpression(expr, meta)));
  }

  throw new Error(`can't convert node of type: ${type} to value - not recognized`);
}

export function mapOp(node, meta) {
  const {operator} = node;
  if (operator === '||' || operator === '&&') {
    return b.logicalExpression(node.operator, mapExpression(node.first, meta), mapExpression(node.second, meta));
  } else if (operator === '!') {
    return b.unaryExpression(node.operator, mapExpression(node.first, meta));
  }
  return b.binaryExpression(node.operator, mapExpression(node.first, meta), mapExpression(node.second, meta));
}

export function mapArguments(args, meta) {
  return args.map((arg)=> mapExpression(arg, meta));
}

export function mapCall(node, meta) {
  return b.callExpression(
    mapExpression(node.variable, meta),
    mapArguments(node.args, meta));
}

export function mapAssignment(node, meta) {
  const identifierName = node.variable.base.value;

  if (meta[identifierName] === undefined && node.variable.properties.length === 0) {
    return mapVariableDeclaration(node, meta);
  }

  return b.expressionStatement(mapExpression(node, meta));
}

export function mapClassBodyElement(node, meta) {
  const methodName = node.variable.base.value;
  let elementType = 'method';

  if (methodName === 'constructor') {
    elementType = 'constructor';
  }

  return b.methodDefinition(elementType, mapExpression(node.variable, meta), mapExpression(node.value, meta));
}

export function getBoundMethodNames(classElements) {
  return classElements.filter((el)=> {
    return el.value.constructor.name === 'Code' &&
      el.value.bound === true;
  }).map(el => mapExpression(el.variable));
}

export function unbindMethods(classElements) {
  return classElements.map((el)=> {
    if (el.value.constructor.name === 'Code') {
      el.value.bound = false;
    }
    return el;
  });
}

export function mapClassBody(node, meta) {
  const {expressions} = node;
  let boundMethods = [];
  let classElements = [];

  if (expressions.length > 0) {
    classElements = node.expressions[0].base.properties;
    boundMethods = getBoundMethodNames(classElements);
    classElements = unbindMethods(classElements);
    classElements = classElements.map( el => mapClassBodyElement(el, meta));
  }

  let constructor = _.findWhere(classElements, {kind: 'constructor'});

  if (boundMethods.length > 0) {
    if (constructor === undefined) {
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
          );
        })
    );
  }

  return b.classBody(classElements);
}

export function mapClassExpression(node, meta) {
  let parent = null;

  if (node.parent !== undefined && node.parent !== null) {
    parent = mapExpression(node.parent, meta);
  }

  return b.classExpression(
    mapExpression(node.variable, meta),
    mapClassBody(node.body, meta),
    parent
  );
}


export function mapClassDeclaration(node, meta) {
  let parent = null;

  if (node.parent !== undefined && node.parent !== null) {
    parent = mapExpression(node.parent, meta);
  }

  return b.classDeclaration(
    mapExpression(node.variable, meta),
    mapClassBody(node.body, meta),
    parent
  );
}

export function mapElseBlock(node, meta) {
  const type = node.constructor.name;

  if (type === 'If') {
    return mapIfStatement(node, meta);
  } else if (type === 'Block') {
    return mapBlockStatement(node, meta);
  }

  return mapBlockStatement({expressions: [node]}, meta);
}

export function mapIfStatement(node, meta) {
  let alternate = null;
  if (node.elseBody) {
    alternate = mapElseBlock(node.elseBody.expressions[0], meta);
  }
  return b.ifStatement(
    mapExpression(node.condition, meta),
    mapBlockStatement(node.body, meta),
    alternate
  );
}

export function mapTryCatchBlock(node, meta) {
  let finalize = null;
  if (node.ensure) {
    finalize = mapBlockStatement(node.ensure, meta);
  }

  return b.tryStatement(
    mapBlockStatement(node.attempt, meta),
    b.catchClause(
      mapLiteral({base: node.errorVariable}, meta),
      null,
      mapBlockStatement(node.recovery, meta)
    ),
    finalize
  );
}

export function mapStatement(node, meta) {
  const type = node.constructor.name;

  if (type === 'Assign') {
    return mapAssignment(node, meta);
  } else if (type === 'For') {
    return mapForStatement(node, meta);
  } else if (type === 'Class') {
    return mapClassDeclaration(node, meta);
  } else if (type === 'Switch') {
    return mapSwitchStatement(node, meta);
  } else if (type === 'If') {
    return mapIfStatement(node, meta);
  } else if (type === 'Try') {
    return mapTryCatchBlock(node, meta);
  }

  return b.expressionStatement(mapExpression(node, meta));
}

export function mapBlockStatement(node, meta) {
  const lastIndex = node.expressions.length - 1;
  return b.blockStatement(node.expressions.map((expr, index) => {
    if (index === lastIndex && isExpression(expr)) {
      return b.returnStatement(mapExpression(expr, meta));
    }
    return mapStatement(expr, meta);
  }));
}

export function mapInArrayExpression(node, meta) {
  return b.memberExpression(
    mapExpression(node.array, meta),
    b.callExpression(
      b.identifier('includes'),
      [mapExpression(node.object, meta)]
    )
  );
}

export function mapFunction(node, meta) {
  const args = mapArguments(node.params, meta);
  const block = mapBlockStatement(node.body, meta);

  if (node.bound === true) {
    return b.arrowFunctionExpression(args, block);
  }

  return b.functionExpression(null, args, block);
}


export function mapSwitchCase(node, meta) {
  let [test] = node;
  const [, block] = node;
  if (test !== null) {
    test = mapExpression(test, meta);
  }
  return b.switchCase(
    test,
    block.expressions.map((expr) => mapStatement(expr, meta))
  );
}

export function mapSwitchStatement(node, meta) {
  let cases = [];

  if (node.cases && node.cases.length > 0) {
    cases = cases.concat(node.cases);
  }

  if (node.otherwise) {
    cases.push([null, node.otherwise]);
  }

  return b.switchStatement(
    mapExpression(node.subject, meta),
    cases.map((expr) => mapSwitchCase(expr, meta))
  );
}

export function mapForStatement(node, meta) {
  if (node.object === false) {
    return b.forInStatement(
      b.variableDeclaration(
        'let',
        [mapExpression(node.name, Object.assign({}, meta, { left: true }))]
      ),
      mapExpression(node.source, meta),
      mapBlockStatement(node.body, meta)
    );
  }
}


export function mapForExpression(node, meta) {
  return b.memberExpression(
    mapExpression(node.source, meta),
    b.callExpression(
      b.identifier('map'),
      [
        b.arrowFunctionExpression(
          [mapExpression(node.name, meta)],
          mapBlockStatement(node.body, meta)
        ),
      ]
    )
  );
}

export function mapExpression(node, meta) {
  const type = node.constructor.name;

  if (node.properties && node.properties.length > 0) {
    return mapMemberExpression([node.base, ...node.properties]);
  } else if (type === 'Assign') {
    return mapAssignmentExpression(node, meta);
  } else if (type === 'For') {
    return mapForExpression(node, meta);
  } else if (type === 'Param') {
    return mapExpression(node.name, meta);
  } else if (type === 'Class') {
    return mapClassExpression(node, meta);
  } else if (type === 'Extends') {
    return mapExpression(node.parent, meta);
  } else if (type === 'Code') { // Code is just a stupid word for function
    return mapFunction(node, meta);
  } else if (type === 'Index') {
    return mapExpression(node.index, meta);
  } else if (type === 'Access') {
    return mapExpression(node.name, meta);
  } else if (type === 'Literal') {
    return mapLiteral({base: node}, meta);
  } else if (type === 'In') {
    return mapInArrayExpression(node, meta);
  } else if (type === 'Value') {
    return mapValue(node, meta);
  } else if (type === 'Op') {
    return mapOp(node, meta);
  } else if (type === 'Call') {
    return mapCall(node, meta);
  }

  throw new Error(`can't convert node of type: ${type} to Expression - not recognized`);
}

export function mapAssignmentExpression(node, meta) {
  return b.assignmentExpression(
    '=',
    mapExpression(node.variable, meta),
    mapExpression(node.value, meta));
}

export function mapObjectPatternItem(node, meta) {
  const type = node.constructor.name;
  if (type === 'Value') {
    return mapLiteral(node, meta);
  } else if (type === 'Assign') {
    if (node.value.base.properties) {
      return mapObjectPattern(node.value.base.properties, meta);
    }
    return mapExpression(node.value, meta);
  }

  throw new Error(`can't convert node of type: ${type} to ObjectPatternItem - not recognized`);
}

export function mapObjectPattern(nodes, meta) {
  return b.objectPattern(nodes.map((node) => {
    const {operatorToken} = node;
    let prop;
    prop = b.property(
      'init',
      mapKey(node.variable || node, meta),
      mapObjectPatternItem(node, meta)
    );

    if (operatorToken === undefined) {
      prop.shorthand = true;
    }
    return prop;
  }));
}

export function mapArrayPattern(node, meta) {
  return b.arrayPattern(node.objects.map((prop)=> {
    const type = prop.base.constructor.name;
    if (type === 'Literal') {
      return mapLiteral(prop, meta);
    } else if (type === 'Arr') {
      return mapArrayPattern(prop.base, meta);
    } else if (type === 'Obj') {
      return mapObjectPattern(prop.base.properties, Object.assign({}, meta, {left: true}));
    }
  }));
}

export function mapAssignmentPattern(node, meta) {
  // that's a destructuring assignment
  const type = node.constructor.name;

  if (type === 'Obj' && node.properties) {
    return mapObjectPattern(node.properties, meta);
  } else if (type === 'Arr') {
    return mapArrayPattern(node, meta);
  }

  return mapExpression(node, meta);
}

export function mapAssignmentLeftHand(node, meta) {
  const type = node.constructor.name;
  if (type === 'Value') {
    return mapAssignmentPattern(node.base, meta);
  }
  return mapExpression(node, meta);
}

export function mapVariableDeclaration(node, meta) {
  const identifierName = node.variable.base.value;
  meta[identifierName] = true;
  return b.variableDeclaration('var', [
    b.variableDeclarator(
      mapAssignmentLeftHand(node.variable, meta),
      mapExpression(node.value, meta))]);
}

export function parse(coffeeSource, basemeta = {}) {
  const ast = coffeeAst(coffeeSource);
  const body = ast.expressions.map((node) => mapStatement(node, basemeta));
  const program = b.program(body);
  return program;
}

export function compile(coffeeSource, options = {}) {
  return recast.print(parse(coffeeSource), options);
}
