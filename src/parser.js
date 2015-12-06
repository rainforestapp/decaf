import {builders as b} from 'ast-types';
import recast from 'recast';
import {nodes as coffeeAst} from 'coffee-script';
import {Scope} from 'coffee-script/lib/coffee-script/scope';
import findWhere from 'lodash/collection/findWhere';
import findIndex from 'lodash/array/findIndex';
import any from 'lodash/collection/any';

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

export function mapRange(node, meta) {
  const compiledRange = recast.parse(node.compile(meta)).program.body[0];
  return compiledRange.expression;
}

export function mapSlice(node, meta) {
  return b.callExpression(
    b.identifier('splice'),
    [
      mapExpression(node.range.from, meta),
      mapExpression(node.range.to, meta),
    ]
  );
}

export function mapValue(node, meta) {
  const type = node.base.constructor.name;

  if (type === 'Literal') {
    return mapLiteral(node, meta);
  } else if (type === 'Range') {
    return mapRange(node, meta);
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
    return b.logicalExpression(
      node.operator,
      mapExpression(node.first, meta),
      mapExpression(node.second, meta));
  } else if (operator === '!') {
    return b.unaryExpression(
      node.operator,
      mapExpression(node.first, meta));
  }
  return b.binaryExpression(
    node.operator,
    mapExpression(node.first, meta),
    mapExpression(node.second, meta));
}

export function mapArguments(args, meta) {
  return args.map((arg)=> mapExpression(arg, meta));
}

export function mapCall(node, meta) {
  let left;
  const {methodName} = meta;

  if (node.isSuper === true && methodName === 'constructor') {
    left = b.identifier('super');
  } else if (node.isSuper === true) {
    left = b.memberExpression(
      b.identifier('super'),
      b.identifier(methodName)
    );
  } else {
    left = mapExpression(node.variable, meta);
  }

  return b.callExpression(
    left,
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

  const _meta = Object.assign(
    {},
    meta,
    {methodName});

  return b.methodDefinition(
    elementType,
    mapExpression(node.variable, _meta),
    mapExpression(node.value, _meta));
}

export function getBoundMethodNames(classElements, meta) {
  return classElements.filter((el)=> {
    return el.value.constructor.name === 'Code' &&
      el.value.bound === true;
  }).map(el => mapExpression(el.variable, meta));
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
    boundMethods = getBoundMethodNames(classElements, meta);
    classElements = unbindMethods(classElements);
    classElements = classElements.map( el => mapClassBodyElement(el, meta));
  }

  let constructor = findWhere(classElements, {kind: 'constructor'});

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

export function extractArgumentMemberAssignment(nodes) {
  return nodes
  .filter(node =>
          node.type === 'AssignmentExpression' &&
          node.left.type === 'MemberExpression')
  .map((node)=> {
    return b.expressionStatement(
      b.assignmentExpression(
        node.operator,
        node.left,
        node.left.property
      )
    );
  });
}

export function normalizeArguments(nodes) {
  return nodes.map((node) => {
    if (node.type === 'AssignmentExpression' &&
       node.left.type === 'MemberExpression') {
      return b.assignmentExpression(
        node.operator,
        node.left.property,
        node.right
      );
    }
    return node;
  });
}

// index can be an expression in this case
export function mapArgumentWithExpansion(node, meta, arg) {
  const expr = mapExpression(node.name, meta);
  const statements = [];

  if (node.name.base && node.name.base.value === 'this') {
    statements.push(b.expressionStatement(b.assignmentExpression(
      '=',
      expr,
      arg
    )));
  } else {
    statements.push(b.variableDeclaration(
      'var',
      [b.variableDeclarator(
        expr,
        arg
      )]
    ));
  }

  if (node.value !== undefined && node.value !== null) {
    statements.push(b.ifStatement(
      b.binaryExpression(
        '===',
        arg,
        b.identifier('undefined')
      ),
      b.expressionStatement(b.assignmentExpression(
        '=',
        expr,
        mapExpression(node.value, meta)
      ))
    ));
  }
  return statements;
}

export function mapSplatArgument(headLength, tailCount) {
  return b.memberExpression(
    b.identifier('arguments'),
    b.callExpression(
      b.identifier('slice'),
      [
        b.literal(headLength),
        b.memberExpression(
          b.identifier('arguments'),
          b.binaryExpression(
            '-',
            b.memberExpression(
              b.identifier('arguments'),
              b.identifier('length')
            ),
            b.literal(tailCount)
          ),
          true
        ),
      ]
    )
  );
}

export function mapArgumentsWithExpansion(nodes, meta) {
  // In coffeescript you can have arguments that are
  // positioned at the end like this: fn = (begin, middle..., end) ->
  // The bit in the middle is of type Splat or Expansion. Expansion
  // purely exists for defining such a 'last' Argument. There can be
  // one or more last arguments. There can not be more than one
  // argument of type Splat or Expansion however.
  // Last arguments behave as normal

  // Initiate statements variable, we'll fill this up.
  const statements = [];

  // find expansion index
  const expansionIndex = findIndex(nodes, (node) => node.constructor.name === 'Expansion' || node.splat === true);
  const isSplat = any(nodes, (node) => node.splat === true);

  // separate head[] from tail[], omit the index.
  const head = nodes.slice(0, expansionIndex);
  const tail = nodes.slice(expansionIndex + 1, nodes.length);

  if (isSplat === true) {
    // if the expansion is a splat we'll add it to head
    // so it gets processed
    head.push(nodes[expansionIndex]);
  }

  // loop over head and tail and create assignment expression
  // statements

  // build head[] statements
  head.forEach((node, index)=>{
    let argument;
    if (node.splat === true) {
      argument = mapSplatArgument(head.length, tail.length);
    } else {
      argument = b.memberExpression(
        b.identifier('arguments'),
        b.literal(index),
        true
      );
    }

    statements
      .push
      .apply(
        statements,
        mapArgumentWithExpansion(
          node,
          meta,
          argument
        ));
  });

  // build tail[] statements
  tail.reverse().forEach((node, index) => {
    const argument =
      b.memberExpression(
        b.identifier('arguments'),
        b.binaryExpression(
          '-',
          b.memberExpression(
            b.identifier('arguments'),
            b.identifier('length')
          ),
          b.literal(index + 1)
        ),
        true
      );

    statements
      .push
      .apply(
        statements,
        mapArgumentWithExpansion(
          node,
          meta,
          argument
        ));
  });

  return statements;
}

export function mapFunction(node, meta) {
  let args = [];

  // setupStatements will be appended at the top of the function
  // block. It's used to add behaviour that would be impossible to
  // map 1 to 1 from coffeescript
  let setupStatements = [];

  // Expansions are coffee-script-only behaviour. We'll need to do
  // some plumbing to map Expansions to JavaScript, also we don't
  // want to rely on the coffeescript parser for this as the output
  // is quite weird/ugly
  const hasExpansion = any(node.params, (param, index) => {
    // if the last argument isn't a splat or expansion we needn't worry
    // To spell it out the logic here is:
    // If this isn't the last argument, and
    // the argument is either an expansion or a splat
    // then we return true
    return (index < (node.params.length - 1) &&
            (param.constructor.name === 'Expansion' ||
             param.splat === true ));
  });

  if (hasExpansion === false) {
    args = mapArguments(node.params, meta);
  }

  if (hasExpansion === true) {
    setupStatements = setupStatements.concat(setupStatements, mapArgumentsWithExpansion(node.params, meta));
  }

  // In coffeescript you can immediately assign an argument to a
  // member of `this`. Which looks like this: fn = (@a = 'A') ->
  // For our compilation we translate it like
  // fn = function(a = 'A') { this.a = a; } as there is no 1 to 1
  // solution here
  setupStatements = setupStatements.concat(extractArgumentMemberAssignment(args, meta));

  const block = mapBlockStatement(node.body, meta);

  block.body = setupStatements.concat(block.body);
  args = normalizeArguments(args, meta);

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

function mapLeftHandForExpression(node, meta) {
  if (node.step !== undefined) {
    return b.memberExpression(
      mapExpression(node.source, meta),
      b.callExpression(
        b.identifier('filter'),
        [
          b.arrowFunctionExpression(
            [b.identifier('_'), b.identifier('_i')],
            b.blockStatement(
              [b.returnStatement(
                b.logicalExpression(
                  '||',
                  b.binaryExpression('===', b.identifier('_i'), b.literal(0)),
                  b.binaryExpression(
                    '===',
                    b.binaryExpression(
                      '%',
                      b.identifier('_i'),
                      b.binaryExpression(
                        '+',
                        mapExpression(node.step, meta),
                        b.literal(1)
                      )
                    ),
                    b.literal(0)
                  )
                )
              )],
              recast.parse('return _i === 0 || _i % (2 + 1) == 0;').program.body
            )
          ),
        ]
      )
    );
  }

  return mapExpression(node.source, meta);
}

export function mapForExpression(node, meta) {
  const leftHand = mapLeftHandForExpression(node, meta);
  return b.memberExpression(
    leftHand,
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

export function mapSplatParam(node, meta) {
  return b.restElement(mapExpression(node, meta));
}

export function mapParam(node, meta) {
  if (node.value !== undefined && node.value !== null) {
    return mapExpression(mapParamToAssignment(node), meta);
  } else if (node.splat === true) {
    return mapSplatParam(node.name, meta);
  }
  return mapExpression(node.name, meta);
}

export function mapSplat(node, meta) {
  return b.spreadElement(mapExpression(node.name, meta));
}

export function mapExpression(node, meta) {
  const type = node.constructor.name;

  if (node.properties && node.properties.length > 0) {
    return mapMemberExpression([node.base, ...node.properties], meta);
  } else if (type === 'Splat') {
    return mapSplat(node, meta);
  } else if (type === 'Assign') {
    return mapAssignmentExpression(node, meta);
  } else if (type === 'Slice') {
    return mapSlice(node, meta);
  } else if (type === 'For') {
    return mapForExpression(node, meta);
  } else if (type === 'Param') {
    return mapParam(node, meta);
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

export function mapParamToAssignment(node) {
  const assignment = {
    variable: node.name,
    value: node.value,
  };
  assignment.constructor = {name: 'Assign'};
  return assignment;
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

export function parse(coffeeSource) {
  const ast = coffeeAst(coffeeSource);
  const scope = new Scope(null, parse, null, []);
  const meta = {scope, indent: ' '};
  const body = ast.expressions.map((node) => mapStatement(node, meta));
  const program = b.program(body);
  return program;
}

export function compile(coffeeSource, opts) {
  return recast.prettyPrint(parse(coffeeSource), opts);
}
