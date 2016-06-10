import {builders as b, namedTypes as n} from 'ast-types';
import recast from 'recast';
import {nodes as coffeeAst} from 'coffee-script';
import {Scope} from 'coffee-script/lib/coffee-script/scope';
import {Code, Block} from 'coffee-script/lib/coffee-script/nodes';
import findWhere from 'lodash/collection/findWhere';
import last from 'lodash/array/last';
import flatten from 'lodash/array/flatten';
import findIndex from 'lodash/array/findIndex';
import get from 'lodash/object/get';
import compose from 'lodash/function/compose';
import isArray from 'lodash/lang/isArray';
import any from 'lodash/collection/any';
import jsc from 'jscodeshift';

// regexes taken from coffeescript parser
const IS_NUMBER = /^[+-]?(?:0x[\da-f]+|\d*\.?\d+(?:e[+-]?\d+)?)$/i;
const IS_STRING = /^['"]/;
const IS_REGEX = /^\//;

function mapBoolean(node) {
  if (node.base.val === 'true') {
    return b.literal(true);
  } else if (node.base.val === 'false') {
    return b.literal(false);
  }

  throwError(node.locationData, `can't convert node of type: ${node.constructor.name} to boolean - not recognized`);
}

function stringToRegex(inputstring) {
  const match = inputstring.match(new RegExp('^/(.*?)/([gimy]*)$'));
  return new RegExp(match[1], match[2]);
}

function mapMemberProperties(properties, meta) {
  const restProperties = properties.slice(0, properties.length - 1);
  const isIndex = properties[properties.length - 1].constructor.name === 'Index';
  const right = mapExpression(properties[properties.length - 1], meta);
  const isComputed = (right.type === 'Literal' || isIndex);
  let left;

  if (restProperties.length === 1) {
    left = mapExpression(restProperties[0], meta);
  } else {
    left = mapMemberProperties(restProperties, meta);
  }

  return b.memberExpression(left, right, isComputed);
}

function mapMemberExpression(node, meta) {
  if (findIndex(node.base.properties, {soak: true}) > -1 ||
     (node.properties && findIndex(node.properties, {soak: true}) > -1)) {
    return fallback(node, meta);
  }
  return mapMemberProperties([node.base, ...node.properties], meta);
}

function mapLiteral(node) {
  let value;
  value = node.base.value;

  if (value === 'NaN') {
    return b.literal(NaN);
  } else if (IS_STRING.test(value)) {
    return b.literal(eval(value)); // eslint-disable-line no-eval
  } else if (IS_NUMBER.test(value)) {
    return b.literal(Number(value));
  } else if (IS_REGEX.test(value)) {
    return b.literal(stringToRegex(value));
  }

  return b.identifier(value);
}

function mapKey(node) {
  const type = node.base.constructor.name;
  if (type === 'Literal') {
    return b.identifier(node.base.value);
  }
}

function mapObjectExpression(node, meta) {
  return b.objectExpression(node.base.properties.map(property =>
    b.property(
      'init',
      mapExpression(property.variable || property.base, meta),
      mapExpression(property.value || property.base, meta))
  ));
}

function mapArrayExpression(node, meta) {
  return b.arrayExpression(node.objects.map(expr => mapExpression(expr, meta)));
}

function mapRange(node, meta) {
  const compiledRange = recast.parse(recast.prettyPrint(recast.parse(node.compile(meta)))).program.body[0];
  return compiledRange.expression;
}

function mapSlice(node, meta) {
  const {range} = node;
  const args = [range.from ? mapExpression(range.from, meta) : b.literal(0)];
  if (range.to) {
    args.push(mapExpression(range.to, meta));
  }
  return b.callExpression(b.identifier('slice'), args);
}

function mapValue(node, meta) {
  const type = node.base.constructor.name;

  if (type === 'Literal') {
    return mapLiteral(node, meta);
  } else if (type === 'Range') {
    return mapRange(node, meta);
  } else if (type === 'Undefined') {
    return b.identifier('undefined');
  } else if (type === 'Null') {
    return b.identifier('null');
  } else if (type === 'Call') {
    return mapCall(node.base, meta);
  } else if (type === 'Bool') {
    return mapBoolean(node, meta);
  } else if (type === 'Arr' && meta.left === true) {
    return mapArrayPattern(node.base, meta);
  } else if (type === 'Obj' && meta.left === true) {
    return mapObjectPattern(node.base.properties, meta);
  } else if (type === 'Arr') {
    return mapArrayExpression(node.base, meta);
  } else if (type === 'Obj') {
    return mapObjectExpression(node, meta);
  } else if (type === 'Parens') {
    return b.sequenceExpression(node.base.body.expressions.map(expr => mapExpression(expr, meta)));
  }

  throwError(node.locationData, `can't convert node of type: ${type} to value - not recognized`);
}

function mapOp(node, meta) {
  const {operator} = node;

  // fall back to coffee-script modulo
  if (operator === '%%' && node.second) {
    return fallback(node, meta);
  }

  // if the cs pow operator is used, map it
  if (operator === '**') {
    return fallback(node, meta);
  }

  // fall back to coffee-script conditional operator
  if (operator === '?') {
    return fallback(node, meta);
  }

  if (operator === '++' || operator === '--') {
    return b.updateExpression(
      operator,
      mapExpression(node.first, meta),
      !node.flip);
  }

  if (node.properties) {
    return mapExpression(node, meta);
  }

  if (node.args) {
    return mapCall(node, meta);
  }

  if (!node.second) {
    return b.unaryExpression(
      operator,
      mapExpression(node.first, meta));
  }

  if (operator === '||' || operator === '&&') {
    return b.logicalExpression(
      operator,
      mapExpression(node.first, meta),
      mapExpression(node.second, meta));
  }

  return b.binaryExpression(
    operator,
    mapExpression(node.first, meta),
    mapExpression(node.second, meta));
}

function mapArguments(args, meta) {
  return args.map(arg => {
    const argName = get(arg.name, 'constructor.name');
    if ((argName === 'Obj' && arg.name.objects.length === 0) ||
        (argName === 'Arr' && arg.name.objects.length === 0)
       ) {
      return b.identifier(meta.scope.freeVariable('arg'));
    }

    if (arg.constructor.name === 'Expansion') {
      return b.restElement(b.identifier(meta.scope.freeVariable('args')));
    }

    let type;
    if (arg.name && arg.name.constructor) {
      type = arg.name.constructor.name;
    }
    if (type === 'Arr') {
      return mapArrayPattern(arg.name, meta);
    } else if (type === 'Obj') {
      return mapObjectPattern(arg.name.properties, meta);
    }

    return mapExpression(arg, meta);
  });
}

function mapCall(node, meta) {
  let left;
  const {superMethodName} = meta;

  // fallback early if variable name contains an existential operator
  if (node.variable && (findIndex(get(node, 'variable.base.properties'), {soak: true}) > -1 ||
     (node.variable.properties && findIndex(node.variable.properties, {soak: true}) > -1))) {
    return fallback(node, meta);
  }

  if (node.soak === true) {
    return recast
      .parse(node.compile(meta))
      .program.body[0].expression;
  } else if (node.isSuper === true && superMethodName === 'constructor') {
    left = b.identifier('super');
  } else if (node.isSuper === true && superMethodName !== undefined) {
    left = b.memberExpression(
      b.identifier('super'),
      b.identifier(superMethodName)
    );
  } else {
    left = mapExpression(node.variable, meta);
  }

  return b.callExpression(
    left,
    mapArguments(node.args, meta));
}

function mapClassProperty(node, meta) {
  return b.classProperty(mapExpression(node.variable, meta), mapExpression(node.value, meta), null);
}

function mapClassBodyElement(node, meta) {
  const superMethodName = node.variable.base.value;
  let elementType = 'method';
  let isStatic = false;
  // const type = node.constructor.name;

  //  if (type === 'Assign' && node.value) {
  //    node.value.name = node.variable.base.value;
  //    node.value.variable = node.variable;
  //  }

  if (node.variable.this === true) {
    isStatic = true;
    node.variable = get(node, 'variable.properties[0].name');
  }

  if (node.constructor.name === 'Assign' &&
      node.value && node.value.constructor.name !== 'Code') {
    if (isStatic === true) {
      return mapStaticClassProperty(node, meta);
    }
    return mapClassProperty(node, meta);
  }

  if (superMethodName === 'constructor') {
    elementType = 'constructor';
  }

  const _meta = Object.assign(
    {},
    meta,
    {isSuperMethod: true},
    {superMethodName});

  return b.methodDefinition(
    elementType,
    mapExpression(node.variable, _meta),
    mapExpression(node.value, _meta),
    isStatic
  );
}

function getBoundMethodNames(classElements, meta) {
  return flatten(classElements
      .filter(el => el.base && el.base.properties)
      .map(el => el.base.properties)
    )
    .filter(el => get(el, 'variable.this') !== true &&
      get(el, 'value.constructor.name') === 'Code' &&
        el.value.bound === true
    ).map(el => mapExpression(el.variable, meta));
}

function unbindMethods(classElements) {
  return classElements.map(el => {
    if (get(el, 'value.constructor.name') === 'Code') {
      el.value.bound = false;
    }
    return el;
  });
}

function mapStaticClassProperty(node, meta) {
  const variable = get(node, 'variable.properties[0]') || node.variable;
  return b.classProperty(mapExpression(variable, meta), mapExpression(node.value, meta), null, true);
}

function mapClassExpressions(expressions, meta) {
  return expressions.reduce((arr, expr) => {
    const type = expr.constructor.name;
    let classElements = [];
    if (type === 'Assign') {
      if (expr.variable && expr.variable.this === true) {
        return arr.concat([mapStaticClassProperty(expr, meta)]);
      }
    } else if (type === 'Value') {
      classElements = expr.base.properties
      // filter out instance field variables
      .filter(prop => !(get(prop, 'operatorToken.value') === ':' &&
                        get(prop, 'value.constructor.name') !== 'Code' &&
                        get(prop, 'variable.base.value') !== 'this'));
      classElements = unbindMethods(classElements);
      classElements = classElements.filter(el => el.constructor.name !== 'Comment');
      classElements = classElements.map(el => mapClassBodyElement(el, meta));
      return arr.concat(classElements);
    }
    return arr;
  }, []);
}

function disallowPrivateClassStatements(node) {
  if (any(node.expressions, expr => (
    expr.constructor.name === 'Call' ||
    (expr.constructor.name === 'Assign' && get(expr, 'variable.this') !== true)
  ))) {
    throwError(node.locationData, 'Private Class statements are not allowed.');
  }
}

function mapClassBody(node, meta) {
  const {expressions} = node;
  const boundMethods = getBoundMethodNames(expressions, meta);
  const classElements = mapClassExpressions(expressions, meta);
  let constructor = findWhere(classElements, {kind: 'constructor'});

  disallowPrivateClassStatements(node);

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
    const body = constructor.value.body.body;
    const hasSuper = !!findWhere(body, {
      expression: {
        callee: {
          name: 'super',
        },
      },
    });

    body.splice(hasSuper ? 1 : 0, 0,
      ...boundMethods.map(identifier =>
        b.expressionStatement(
          b.assignmentExpression('=',
            b.memberExpression(
              b.thisExpression(),
              identifier
            ),
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
        )
      )
    );
  }

  return b.classBody(classElements);
}

function mapClassExpression(node, meta) {
  // if this is an anonymous class expression fallback
  // to the cs compiler
  if (node.variable === undefined &&
      node.parent === undefined &&
      node.body.expressions.length < 1) {
    return fallback(node, meta);
  }

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

function mapClassDeclaration(node, meta) {
  let parent = null;

  if (node.variable) {
    node.ensureConstructor(node.variable.base.value);
  }

  const code = new Code([], Block.wrap([node.body]));
  meta = Object.assign({}, meta, {classScope: code.makeScope(meta.scope)});

  if (get(node, 'variable.properties.length') > 0) {
    return b.expressionStatement(b.assignmentExpression(
      '=',
      mapExpression(node.variable, meta),
      mapClassExpression(Object.assign({}, node, {variable: last(node.variable.properties)}), meta)
    ));
  }

  if (node.parent !== undefined && node.parent !== null) {
    parent = mapExpression(node.parent, meta);
    meta = Object.assign({}, meta, { extendedClass: true });
  }

  if (!node.variable) {
    return b.expressionStatement(
      b.parenthesizedExpression(
        b.classExpression(
          null,
          mapClassBody(node.body, meta),
          parent
        )
      )
    );
  }

  return b.classDeclaration(
    mapExpression(node.variable, meta),
    mapClassBody(node.body, meta),
    parent
  );
}

function mapElseBlock(node, meta) {
  const type = node.constructor.name;

  if (type === 'If') {
    const conditional = mapIfStatement(node, meta);
    if (n.IfStatement.check(conditional)) {
      return conditional;
    }
    return b.blockStatement([conditional]);
  } else if (type === 'Block') {
    return mapBlockStatement(node, meta);
  }

  return mapBlockStatement({expressions: [node]}, meta);
}

function mapElseExpression(node, meta) {
  const type = node.constructor.name;

  if (type === 'If') {
    return mapConditionalExpression(node, meta);
  } else if (type === 'Block') {
    return mapExpression(node.expressions[0], meta);
  }

  return mapExpression(node, meta);
}

function mapConditionalExpression(node, meta) {
  let alternate = b.identifier('undefined');

  if (node.elseBody) {
    alternate = mapElseExpression(node.elseBody.expressions[0], meta);
  }

  return b.conditionalExpression(
    mapExpression(node.condition, meta),
    mapExpression(node.body.expressions[0], meta),
    alternate
  );
}

function mapTryExpression(node, meta) {
  const tryBlock = mapTryCatchBlock(node, meta);
  tryBlock.block = addReturnStatementToBlock(tryBlock.block);
  return b.callExpression(
    b.arrowFunctionExpression(
      [],
      b.blockStatement(
        [tryBlock]
      )
    ),
    []
  );
}


function mapIfStatement(node, meta) {
  let alternate = null;
  let elseBody = node.elseBody;

  // The coffeescript doesn't explicitly tell you if something is
  // an if-else block so we need to make some checks and then a little
  // plumbing to put this in the right place.
  if (get(elseBody, 'expressions.length') === 1 &&
     get(elseBody, 'expressions[0].constructor.name') === 'If') {
    elseBody = elseBody.expressions[0];
  }

  if (elseBody) {
    alternate = mapElseBlock(elseBody, meta);
  }

  return b.ifStatement(
    mapExpression(node.condition, meta),
    mapBlockStatement(node.body, meta),
    alternate
  );
}

function isTernaryOperation(node) {
  const regex = /^(Literal|Code)/;

  return (
    get(node, 'body.expressions.length') === 1 &&
    regex.test(get(node, 'body.expressions[0].base.constructor.name')) &&
    regex.test(get(node, 'elseBody.expressions[0].base.constructor.name')) &&
    get(node, 'elseBody.expressions.length') === 1
  );
}

function mapConditionalStatement(node, meta) {
  if (isTernaryOperation(node)) {
    return b.expressionStatement(mapConditionalExpression(node, meta));
  }
  return mapIfStatement(node, meta);
}

function mapTryCatchBlock(node, meta) {
  let finalize = null;
  let catchBlock = null;
  if (node.recovery) {
    const recovery = mapBlockStatement(node.recovery, meta);
    const errorVar = mapLiteral({base: node.errorVariable}, meta);

    catchBlock = b.catchClause(
      errorVar,
      null,
      recovery
    );
  }

  if (node.ensure) {
    finalize = mapBlockStatement(node.ensure, meta);
  } else if (!catchBlock) {
    finalize = b.blockStatement([]);
  }

  return b.tryStatement(
    mapBlockStatement(node.attempt, meta),
    catchBlock,
    finalize
  );
}

function mapReturnStatement(node, meta) {
  return b.returnStatement(node.expression ? mapExpression(node.expression, meta) : null);
}

function mapStatement(node, meta) {
  const type = node.constructor.name;

  if (type === 'While') {
    return mapWhileLoop(node, meta);
  } else if (type === 'Return') {
    return mapReturnStatement(node, meta);
  } else if (type === 'Throw') {
    return mapThrowStatement(node, meta);
  } else if (type === 'Comment') {
    return b.emptyStatement();
  } else if (type === 'For') {
    return mapForStatement(node, meta);
  } else if (type === 'Class') {
    return mapClassDeclaration(node, meta);
  } else if (type === 'Switch') {
    return mapSwitchStatement(node, meta);
  } else if (type === 'If') {
    return mapConditionalStatement(node, meta);
  } else if (type === 'Try') {
    return mapTryCatchBlock(node, meta);
  }

  return b.expressionStatement(mapExpression(node, meta));
}

function mapBlockStatements(node, meta) {
  return flatten(node.expressions.map(expr => {
    const type = expr.constructor.name;
    let prototypeProps = [];
    if (type === 'Class') {
      // extract prototype assignments
      prototypeProps = flatten(expr.body.expressions
        .filter(ex => (ex.constructor.name === 'Value'))
        .map(ex => (ex.base.properties)))
        .filter(ex => (get(ex, 'operatorToken.value') === ':' &&
                       get(ex, 'value.constructor.name') !== 'Code' &&
                       get(ex, 'variable.base.value') !== 'this'))
        .filter(ex => get(ex, 'value.constructor.name') !== 'Code')
        .map(ex => (
          b.expressionStatement(
            b.assignmentExpression(
              '=',
              b.memberExpression(
                b.memberExpression(
                  mapExpression(expr.variable),
                  b.identifier('prototype')
                ),
                mapExpression(ex.variable, meta)
              ),
              mapExpression(ex.value, meta)
            )
          )
        ));
    }

    return [mapStatement(expr, meta)].concat(prototypeProps);
  }));
}

function addVariablesToScope(nodes = [], meta, context = false) {
  // recursively  add all variables to the cs scope object to
  // prevent any naming collisions that might occur when the
  // coffee-script compiler needs to generate variable names
  nodes.forEach(node => {
    const type = node.constructor.name;

    if (type === 'Param') {
      const nameType = node.name.constructor.name;

      if (nameType === 'Obj' || nameType === 'Arr') {
        addVariablesToScope(node.name.objects, meta, true);
      } else if (nameType === 'Literal') {
        meta.scope.add(node.name.value, 'var');
      }
    } else if (type === 'Code') {
      addVariablesToScope(node.params, meta, true);
    } else if (type === 'Assign') {
      const varType = node.variable.base.constructor.name;

      if (varType === 'Literal') {
        meta.scope.add(node.variable.base.value, 'var');
      }

      if (varType === 'Obj' || varType === 'Arr') {
        addVariablesToScope(node.variable.base.objects, meta, true);
      }

      if (node.context === 'object' && node.value && node.value.base.objects) {
        addVariablesToScope(node.value.base.objects, meta, true);
      }
    } else if (type === 'Value' && context === true) {
      meta.scope.add(node.base.value, 'var');
    }
  });
}

function mapBlockStatement(node, meta, factory = b.blockStatement) {
  addVariablesToScope(node.expressions, meta);
  const block = factory(mapBlockStatements(node, meta));
  return block;
}

function mapInArrayExpression(node, meta) {
  return b.memberExpression(
    mapExpression(node.array, meta),
    b.callExpression(
      b.identifier('includes'),
      [mapExpression(node.object, meta)]
    )
  );
}

function extractAssignStatementsByArguments(nodes) {
  return nodes
    .map(node => node.type === 'AssignmentExpression' ? node.left : node)
    .map(node => node.type === 'RestElement' ? node.argument : node)
    .filter(node => node.type === 'MemberExpression' &&
        (node.object.type === 'ThisExpression' || node.object.name === 'this'))
    .map(node =>
      b.expressionStatement(
        b.assignmentExpression(
          '=',
          node,
          node.property
        )
      )
    );
}

function normalizeArgument(node) {
  if (node.type === 'AssignmentExpression' &&
     node.left.type === 'MemberExpression') {
    return b.assignmentExpression(
      node.operator,
      node.left.property,
      node.right
    );
  }
  if (node.type === 'MemberExpression' &&
     (node.object.type === 'ThisExpression' || node.object.name === 'this')) {
    return {type: 'Identifier', name: node.property.name};
  }
  return node;
}

function normalizeArguments(nodes) {
  return nodes.map(node => {
    if (node.type === 'RestElement') {
      node.argument = normalizeArgument(node.argument);
      return node;
    }
    return normalizeArgument(node);
  });
}

function transformToExpression(_node) {
  let node = _node;

  if (node.expression !== undefined) {
    return node.expression;
  }

  if (node.type === 'IfStatement') {
    node = addReturnStatementToIfBlocks(node);
  } else if (node.tpye === 'SwitchStatement') {
    node = node;
  }

  return b.callExpression(
    b.arrowFunctionExpression(
      [],
      b.blockStatement([node])
    ),
    []
  );
}

function lastReturnStatement(nodeList = []) {
  if (nodeList.length > 0) {
    const lastIndex = nodeList.length - 1;

    if (nodeList[lastIndex].type === 'SwitchStatement') {
      nodeList[lastIndex] = addReturnStatementsToSwitch(nodeList[lastIndex]);
    } else if (nodeList[lastIndex].type === 'ThrowStatement') {
      return nodeList;
    } else if (nodeList[lastIndex].type === 'IfStatement') {
      nodeList[lastIndex] = addReturnStatementToIfBlocks(nodeList[lastIndex]);
    } else {
      nodeList[lastIndex] =
        b.returnStatement(
          transformToExpression(nodeList[nodeList.length - 1]));
    }
  }
  return nodeList;
}

function lastBreakStatement(nodeList = []) {
  const returns = nodeList.filter(node => node.type === 'ReturnStatement');
  if (returns.length < 1 && nodeList.length > 0) {
    nodeList.push(b.breakStatement());
  }
  return nodeList;
}

function addReturnStatementToIfBlocks(node) {
  node.consequent = addReturnStatementToBlock(node.consequent);
  if (n.IfStatement.check(node.alternate)) {
    node.alternate = addReturnStatementToIfBlocks(node.alternate);
  } else if (n.ExpressionStatement.check(node.alternate)) {
    node.alternate = b.returnStatement(node.alternate.expression);
  } else if (node.alternate) {
    node.alternate = addReturnStatementToBlock(node.alternate);
  }
  return node;
}

function addReturnStatementToBlock(node) {
  const hasReturnStatement = findIndex(node.body, {type: 'ReturnStatement'}) === node.body.length - 1;

  if (hasReturnStatement) {
    return node;
  }
  node.body = lastReturnStatement(node.body);
  return node;
}

function detectIllegalSuper(node, meta) {
  const superIndex = findIndex(get(node, 'body.expressions'), {isSuper: true});
  const hasArgumentAssignments = any(node.params, {name: {this: true}});
  const isConstructor = meta.superMethodName === 'constructor';
  const isExtendedClass = meta.extendedClass;
  const firstThisAssignmentIndex = findIndex(get(node, 'body.expressions'), {variable: {this: true}});
  const superCall = get(node, 'body.expressions')[superIndex];

  const hasArgumentAssignmentsAndSuperCall =
    isExtendedClass &&
    isConstructor &&
    hasArgumentAssignments &&
    superIndex > -1;

  const hasSuperCallAfterThisAssignments =
    isExtendedClass &&
    isConstructor &&
    firstThisAssignmentIndex > -1 &&
    superIndex > firstThisAssignmentIndex;

  if (hasArgumentAssignmentsAndSuperCall ||
      hasSuperCallAfterThisAssignments) {
    throwError(
      superCall.locationData,
      'Illegal use of super() in constructor. super must be called before any this assignments');
  }
}

function throwError(locData, msg) {
  throw new Error(`[${locData.first_line}:${locData.first_column}] - ${msg}`);
}

function mapFunction(node, meta) {
  // Function {
  //   params: [],
  //   body: [statements],
  //   bound: Boolean
  // }
  const isGenerator = node.isGenerator;
  const isConstructor = meta.superMethodName === 'constructor' && meta.isSuperMethod;

  // throw an error when there's an illegal super statement
  detectIllegalSuper(node, meta);

  meta = Object.assign({}, meta, {scope: node.makeScope(meta.scope)}, {isSuperMethod: false});

  let args = mapArguments(node.params, meta);
  // restIndex is the location of the splat argument
  const restIndex = findIndex(args, n.RestElement.check);
  // In coffeescript you can immediately assign an argument to a
  // member of `this`. Which looks like this: fn = (@a = 'A') ->
  // For our compilation we translate it like
  // fn = function(a) { this.a = a; } as there is no 1 to 1
  // solution here
  // setupStatements will be appended at the top of the function
  // block. It's used to add behaviour that would be impossible to
  // map 1 to 1 from coffeescript
  let setupStatements = extractAssignStatementsByArguments(args, meta);
  // Remove any assignments to this, as those are in setupStatements by now
  args = normalizeArguments(args, meta);

  // In CoffeeScript you can have arguments after the rest argument, as a 'tail' of sorts
  // This is not possible in es2015, so instead we change something like: fn = (a, b..., c) ->
  // To: fn = function(a, ...b) { var [c] = b.splice(Math.max(0, b.length - 1)); }
  if (restIndex !== -1 && restIndex < args.length - 1) {
    const tailArgs = args.splice(restIndex + 1, args.length - restIndex - 1);
    const name = args[restIndex].argument.name;
    const tailStatements = [];
    tailArgs.forEach(arg => {
      if (arg.type === 'AssignmentExpression') {
        arg.type = 'AssignmentPattern';
      }
    });
    tailStatements.unshift(
      b.variableDeclaration(
        'var',
        [b.variableDeclarator(
          b.arrayPattern(tailArgs),
          b.callExpression(b.memberExpression(b.identifier(name), b.identifier('splice')), [
            b.callExpression(b.memberExpression(b.identifier('Math'), b.identifier('max')), [
              b.literal(0),
              b.binaryExpression('-',
                b.memberExpression(b.identifier(name), b.identifier('length')),
                b.literal(tailArgs.length)
              ),
            ]),
          ])
        )]
      )
    );
    setupStatements = tailStatements.concat(setupStatements);
  }

  let block = mapBlockStatement(node.body, meta);

  if (isGenerator === false && !isConstructor) {
    block = addReturnStatementToBlock(block, meta);
  }

  block.body = setupStatements.concat(block.body);

  if (node.bound === true) {
    return b.arrowFunctionExpression(args, block);
  }

  return b.functionExpression(null, args, block, isGenerator);
}

function insertSuperCall(path) {
  const classMethods = get(path, 'value.body.body') || [];
  const constructorIndex = findIndex(classMethods, {kind: 'constructor'});
  if (constructorIndex > -1) {
    const superCalls = jsc(classMethods[constructorIndex])
      .find(jsc.CallExpression, {callee: {name: 'super'}})
      .nodes();
    if (superCalls.length < 1) {
      classMethods[constructorIndex]
        .value.body.body
        .unshift(
          b.expressionStatement(
            b.callExpression(
              b.identifier('super'),
              [b.spreadElement(b.identifier('arguments'))]
            )
          )
        );
    }
  }
}

function insertSuperCalls(ast) {
  jsc(ast)
  .find(jsc.ClassDeclaration, path => get(path, 'superClass'))
  .forEach(insertSuperCall);

  jsc(ast)
  .find(jsc.ClassExpression, path => get(path, 'superClass'))
  .forEach(insertSuperCall);

  return ast;
}

function getDestructuringAssignmentInfo(path) {
  const assignmentPath = path.value.left;
  const targetIds = jsc(assignmentPath)
    .find(jsc.Identifier)
    .filter(_path => _path.parentPath.name === 'elements')
    .paths()
    .map(idPath => idPath.value.name);

  return {
    targetIds,
    undeclaredIds: targetIds.filter(id => !path.scope.lookup(id)),
    hasMemberAssignments: jsc(assignmentPath).find('MemberExpression').size() > 0,
  };
}

function findNodeParent(node, matcher) {
  if (node.parent) {
    if (matcher(node.parent)) {
      return node.parent;
    }
    return findNodeParent(node.parent, matcher);
  }
}

function insertBreakStatements(ast) {
  jsc(ast)
  // find all switch statements
  .find(jsc.SwitchStatement)
  .forEach(node => (
    jsc(node).replaceWith(path => addBreakStatementsToSwitch(path.value))
  ));
  return ast;
}

function insertDestructuringAssignmentVars(path) {
  const {hasMemberAssignments, targetIds, undeclaredIds} = getDestructuringAssignmentInfo(path);
  const {left, right} = path.value;

  if (hasMemberAssignments || undeclaredIds.length !== targetIds.length) {
    undeclaredIds.forEach(id =>
      path.scope.injectTemporary(jsc.identifier(id), null)
    );
  } else {
    jsc(path).replaceWith(() =>
      b.variableDeclaration(
        'var',
        [b.variableDeclarator(
          jsc.arrayPattern(left.elements), right
        )]
      )
    );
  }
  path.scope.scan(true);
}

function insertVariableDeclarations(ast) {
  jsc(ast)
  // first we're going to find all assignments in our code
  .find(jsc.AssignmentExpression, node => (
    !n.MemberExpression.check(node.left) &&
    get(node, 'operator') === '='
  ))
  // then we're going to search for the uppermost assignment
  // of similarly named variables
  .forEach(path => {
    // There's something weird with AssignmentExpressions vs. AssignmentPatterns in function arguments that
    // causes scope.lookup to not find the definition properly.
    if (path.parent.value.type.match(/^(ArrowFunctionExpression|Function(Expression|Statement))$/)) {
      return;
    }

    if (jsc.ArrayExpression.check(path.value.left)) {
      insertDestructuringAssignmentVars(path);
      return;
    }

    const needle = path.value.left.name;

    if (!path.scope.lookup(needle)) {
      const blockNode = findNodeParent(path, node => get(node, 'value.type') === 'BlockStatement');
      if (path.parent &&
          get(path, 'parent.parent.value.type') !== 'SwitchCase' &&
          path.parent.value.type === 'ExpressionStatement' &&
          get(blockNode, 'parent.value.type') !== 'IfStatement') {
        jsc(path).replaceWith(_path =>
          b.variableDeclaration(
            'var',
            [b.variableDeclarator(
              _path.value.left,
              _path.value.right
            )]
          )
        );
      } else {
        path.scope.injectTemporary(path.value.left);
      }
      path.scope.scan(true);
    }
  });
  return ast;
}

function mapSwitchCases(cases, meta) {
  return cases.reduce((arr, nodes) => {
    const tests = isArray(nodes[0]) ? nodes[0] : [nodes[0]];
    const switchCases = tests.filter(expr => !!expr).map(expr => b.switchCase(mapExpression(expr), []));
    const consequent = mapBlockStatements(get(nodes, 1), meta);

    if (switchCases.length > 0) {
      switchCases[switchCases.length - 1].consequent = consequent;
    } else if (switchCases.length === 0 && !!nodes[1]) {
      switchCases.push(b.switchCase(null, consequent));
    }

    return arr.concat(flatten(switchCases));
  }, []);
}

function mapSwitchStatement(node, meta) {
  let cases = [];
  let subject;

  if (node.cases && node.cases.length > 0) {
    cases = cases.concat(node.cases);
  }

  if (node.otherwise) {
    cases.push([null, node.otherwise]);
  }

  cases = mapSwitchCases(cases, meta);

  if (node.subject) {
    subject = mapExpression(node.subject, meta);
  } else {
    cases = cases.map(cas => {
      if (cas.test !== null) {
        cas.test = b.unaryExpression('!', cas.test);
      }
      return cas;
    });
    subject = b.literal(false);
  }

  return b.switchStatement(
    subject,
    cases
  );
}

function mapForGuard(guardNode, blockStatement, meta) {
  const isExistential = guardNode.constructor.name === 'Existence';
  const guardClause = isExistential ?
    mapExistentialExpression(guardNode, meta) :
    mapOp(guardNode.expression || guardNode, meta);

  return b.blockStatement([
    b.ifStatement(
      guardClause,
      blockStatement
    ),
  ]);
}

function mapForStatement(node, meta) {
  let blockStatement = mapBlockStatement(node.body, meta);

  // wrap blockStatement in a conditional if there
  // is a conditional expression attached to the for
  // loop
  if (node.guard) {
    blockStatement = mapForGuard(node.guard, blockStatement, meta);
  }

  if (node.object === false) {
    if (node.index === undefined) {
      const name = node.name === undefined
        ? b.identifier('_i')
        : mapExpression(node.name, Object.assign({}, meta, { left: true }));
      return b.forOfStatement(
        b.variableDeclaration(
          'var',
          [b.variableDeclarator(name, null)]
        ),
        mapExpression(node.source, meta),
        blockStatement
      );
    }
    return b.forOfStatement(
      b.variableDeclaration(
        'var',
        [b.variableDeclarator(b.arrayPattern([
          mapExpression(node.index, meta),
          mapExpression(node.name, meta),
        ]), null)]
      ),
      b.callExpression(
        b.memberExpression(
          mapExpression(node.source, meta),
          b.identifier('entries')
        ),
        []
      ),
      blockStatement
    );
  } else if (node.object === true) {
    let declaration;
    let method;
    if (node.name === undefined) {
      declaration = mapExpression(node.index, meta);
      method = 'keys';
    } else {
      declaration = b.arrayPattern([
        mapExpression(node.index, meta),
        mapExpression(node.name, meta),
      ]);
      method = 'entries';
    }

    return b.forOfStatement(
      b.variableDeclaration(
        'var',
        [b.variableDeclarator(declaration, null)]
      ),
      b.callExpression(
        b.memberExpression(
          b.identifier('Object'),
          b.identifier(method)
        ),
        [mapExpression(node.source, meta)]
      ),
      blockStatement
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

function mapForExpression(node, meta) {
  const leftHand = mapLeftHandForExpression(node, meta);
  const args = [];
  let target;
  if (node.object === true) {
    let method;
    if (node.name === undefined) {
      args.push(mapExpression(node.index, meta));
      method = 'keys';
    } else {
      args.push(b.arrayPattern([
        mapExpression(node.index, meta),
        mapExpression(node.name, meta),
      ]));
      method = 'entries';
    }
    target = b.callExpression(
      b.memberExpression(b.identifier('Object'), b.identifier(method)),
      [leftHand]
    );
  } else {
    target = leftHand;
    if (node.name !== undefined) {
      args.push(mapExpression(node.name, meta));
    }
    if (node.index !== undefined) {
      args.push(mapExpression(node.index, meta));
    }
  }

  return b.callExpression(
    b.memberExpression(
      target,
      b.identifier('map')
    ),
    [
      b.arrowFunctionExpression(
        args,
        addReturnStatementToBlock(mapBlockStatement(node.body, meta))
      ),
    ]
  );
}

function mapSplatParam(node, meta) {
  return b.restElement(mapExpression(node, meta));
}

function mapParam(node, meta) {
  if (node.value !== undefined && node.value !== null) {
    return mapExpression(mapParamToAssignment(node), meta);
  } else if (node.splat === true) {
    return mapSplatParam(node.name, meta);
  }
  return mapExpression(node.name, meta);
}

function mapSplat(node, meta) {
  return b.spreadElement(mapExpression(node.name, meta));
}

function addReturnStatementsToSwitch(node) {
  node.cases = node.cases.map(switchCase => {
    switchCase.consequent = lastReturnStatement(switchCase.consequent);
    return switchCase;
  });
  return node;
}

function addBreakStatementsToSwitch(node) {
  node.cases = node.cases.map((switchCase, index) => {
    const isLastCase = (index + 1) === node.cases.length;
    if (switchCase.test !== null && !isLastCase) {
      switchCase.consequent = lastBreakStatement(switchCase.consequent);
    }
    return switchCase;
  });
  return node;
}

function mapSwitchExpression(node, meta) {
  return b.callExpression(
    b.arrowFunctionExpression(
      [],
      b.blockStatement([addReturnStatementsToSwitch(
        mapSwitchStatement(node, meta)
      )])
    ),
    []
  );
}

function fallback(node, meta) {
  const compiled = node.compile(meta);
  return recast.parse(recast.prettyPrint(
    recast.parse(compiled), meta.options)).program.body[0].expression;
}

function mapExistentialExpression(node, meta) {
  return fallback(node, meta);
}

function mapNewExpression(node, meta) {
  const constructor = node.first || node.variable;
  const args = node.args ? mapArguments(node.args, meta) : [];
  return b.newExpression(mapExpression(constructor, meta), args);
}

function conditionalStatementAsExpression(node, meta) {
  const conditionalStatement = mapConditionalStatement(node, meta);

  if (conditionalStatement.type === 'IfStatement') {
    return b.callExpression(
      b.arrowFunctionExpression(
        [],
        b.blockStatement(
          [addReturnStatementToIfBlocks(conditionalStatement)]
        )
      ),
      []
    );
  }

  return conditionalStatement.expression;
}

// function mapComment(node) {
//   const comment = b.block(node.comment);
//   return comment;
// }

function mapWhileLoop(node, meta) {
  return b.whileStatement(
    mapExpression(node.condition, meta),
    mapBlockStatement(node.body, meta));
}

function mapThrowStatement(node, meta) {
  return b.throwStatement(mapExpression(node.expression, meta));
}

function mapWhileExpression(node, meta) {
  return fallback(node, meta);
}

function mapYieldExpression(node, meta) {
  return b.yieldExpression(mapExpression(node.first, meta));
}

function mapExpression(node, meta) {
  const type = node.constructor.name;

  if (node.properties && node.properties.length > 0) {
    return mapMemberExpression(node, meta);
  } else if (type === 'Range') {
    return mapRange(node, meta);
  } else if (type === 'If') {
    return conditionalStatementAsExpression(node, meta);
  } else if (type === 'Parens' && get(node, 'body.expressions[0]')) {
    return b.parenthesizedExpression(mapExpression(get(node, 'body.expressions[0]'), meta));
  } else if (type === 'Parens') {
    return b.parenthesizedExpression(mapExpression(node.body, meta));
  } else if (type === 'Arr') {
    return mapValue({base: node}, meta);
  } else if (type === 'Try') {
    return mapTryExpression(node, meta);
  } else if (type === 'Call' && node.isNew === true) {
    return mapNewExpression(node, meta);
  } else if (type === 'Op' && node.operator === 'yield') {
    return mapYieldExpression(node, meta);
  } else if (type === 'Op' && node.operator === 'new') {
    return mapNewExpression(node, meta);
  } else if (type === 'Existence') {
    return mapExistentialExpression(node, meta);
  } else if (type === 'While') {
    return mapWhileExpression(node, meta);
  } else if (type === 'Switch') {
    return mapSwitchExpression(node, meta);
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
  } else if (type === 'Extends' && node.parent && node.child) {
    return fallback(node, meta);
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

  throwError(node.locationData, `can't convert node of type: ${type} to Expression - not recognized`);
}

function mapParamToAssignment(node) {
  const assignment = {
    variable: node.name,
    value: node.value,
  };
  assignment.constructor = {name: 'Assign'};
  return assignment;
}

function mapAssignmentExpression(node, meta) {
  let variable;
  const props = get(node, 'variable.base.properties') || [];
  if (any(props, {this: true})) {
    return fallback(node, meta);
  }
  if (get(node, 'variable.base.properties.length') > 0) {
    variable = mapAssignmentPattern(node.variable.base, meta);
  } else {
    variable = mapExpression(node.variable, meta);
  }

  const assignment = b.assignmentExpression(
    '=',
    variable,
    mapExpression(node.value, meta));

  if (node.context === '||=') {
    return b.logicalExpression('||', variable, assignment);
  } else if (node.context === '?=') {
    return b.conditionalExpression(
      b.binaryExpression('!=', variable, b.identifier('null')),
      variable,
      assignment
    );
  }

  assignment.operator = node.context || node.operator || '=';

  return assignment;
}

function mapObjectPatternItem(node, meta) {
  const type = node.constructor.name;
  if (type === 'Value') {
    return mapLiteral(node, meta);
  } else if (type === 'Assign') {
    if (node.value.base.properties) {
      return mapObjectPattern(node.value.base.properties, meta);
    }
    return mapExpression(node.value, meta);
  }

  throwError(node.locationData, `can't convert node of type: ${type} to ObjectPatternItem - not recognized`);
}

function mapObjectPattern(nodes, meta) {
  return b.objectPattern(nodes.map(node => {
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

function mapArrayPattern(node, meta) {
  return b.arrayPattern(node.objects.map(prop => {
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

function mapAssignmentPattern(node, meta) {
  // that's a destructuring assignment
  const type = node.constructor.name;

  if (type === 'Obj' && node.properties) {
    return mapObjectPattern(node.properties, meta);
  } else if (type === 'Arr') {
    return mapArrayPattern(node, meta);
  }

  return mapExpression(node, meta);
}

function coffeeParse(source) {
  const ast = coffeeAst(source);
  return ast;
}

export function transpile(ast, meta) {
  if (meta === undefined) {
    meta = {};
  }

  if (!meta.scope) {
    meta.scope = new Scope(null, ast, null, []);
    meta.indent = ' ';
  }

  const program = mapBlockStatement(ast, meta, b.program);

  const {utilities} = meta.scope;
  const utils = Object.keys(utilities);

  utils.forEach(util => {
    const expr = recast.parse(
      `${utilities[util]} = ${UTILITIES[util](meta)}`
    ).program.body[0];

    delete expr.loc;

    program.body.unshift(expr);
  });

  return program;
}

// Not sure why this is happening just yet,
// backslashes gallore that is :(
export function removeDoubleEscapes(compiled) {
  compiled.code = compiled.code.replace('\\\\\\', '\\');
  return compiled;
}

export function compile(source, opts, parse = coffeeParse) {
  const doubleSemicolon = /\;+/g;
  opts = opts || {tabWidth: 2, quote: 'double'};

  const _compile = compose(
    // hack because of double semicolon
    removeDoubleEscapes,
    compiledSource => Object.assign({}, compiledSource, {code: compiledSource.code.replace(doubleSemicolon, ';')}),
    jsAst => recast.print(jsAst, opts),
    insertSuperCalls,
    insertBreakStatements,
    insertVariableDeclarations,
    csAst => transpile(csAst, {options: opts}),
    parse);

  return _compile(source).code;
}

const UTILITIES = {
  modulo() { return 'function (a, b) { return (+a % (b = +b) + b) % b; }'; },

  extend(o) {
    return `function(child, parent) {
  for (var key in parent) {
    if (${utility('hasProp', o)}.call(parent, key)) child[key] = parent[key];
  }
  function ctor() {
    this.constructor = child;
  }
  ctor.prototype = parent.prototype;
  child.prototype = new ctor();
  child.__super__ = parent.prototype;
  return child;
}`;
  },

  hasProp() { return '{}.hasOwnProperty'; },
};

// Helper for ensuring that utility functions are assigned at the top level.
// copied from coffee-script compiler
function utility(name, o) {
  const {root} = o.scope;

  if (root.utilities[name]) {
    return root.utilities[name];
  }

  const ref = root.freeVariable(name);
  root.assign(ref, UTILITIES[name](o));
  root.utilities[name] = ref;
}
