/* @flow */
import {builders as b, namedTypes as n} from 'ast-types';
import {parse, print, prettyPrint} from 'recast';
import {nodes as coffeeAst} from 'coffee-script';
import {Scope} from 'coffee-script/lib/coffee-script/scope';
import findWhere from 'lodash/collection/findWhere';
import last from 'lodash/array/last';
import flatten from 'lodash/array/flatten';
import pick from 'lodash/object/pick';
import values from 'lodash/object/values';
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

const STRING_INSIDE_QUOTES = /^['"](.*)['"]$/;

function pluck(obj, keys) {
  return values(pick(obj, keys));
}

type CBody = {
  expressions: CNodeList;
}

type CBase = {
  val: any;
  value: any;
  base: CBase;
  soak: boolean;
  isSuper: boolean;
  variable: CNode;
  properties: CBaseList;
  objects: CBaseList;
  compile: function;
  body: CBody;
}

type CArg = {
  name: CBase;
}

type CArgList = Array<CArg|CNode>

type CRange = {
  range: {
    from: CNode;
    to: CNode;
  }
}

type CNode = {
  base: CBase;
  properties: CBaseList;
  objects: CBaseList;
  compile: function;
}

type JSNode = {
  type: string;
}

type CNodeList = Array<CNode>;
type CBaseList = Array<CBase>;

type COp = {
  operator: string;
  first: CNode;
  second: CNode;
  flip: boolean;
}

function mapBoolean(node: CNode) {
  if (node.base.val === 'true') {
    return b.literal(true);
  } else if (node.base.val === 'false') {
    return b.literal(false);
  }

  throw new Error(`can't convert node of type: ${node.constructor.name} to boolean - not recognized`);
}

function stringToRegex(inputstring) {
  const match = inputstring.match(new RegExp('^/(.*?)/([gimy]*)$'));
  return new RegExp(match[1], match[2]);
}

function mapMemberProperties(properties: CBaseList, meta: Object) {
  const head = properties.slice(0, properties.length - 1);
  const lastProperty = last(properties);
  const isIndex = lastProperty.constructor.name === 'Index';
  const right = mapExpression(lastProperty, meta);
  const isComputed = (right.type === 'Literal' || isIndex);
  let left;

  if (head.length === 1) {
    left = mapExpression(head[0], meta);
  } else {
    left = mapMemberProperties(head, meta);
  }

  return b.memberExpression(left, right, isComputed);
}

function mapMemberExpression(node: CNode, meta: Object) {
  if (findIndex(node.base.properties, {soak: true}) > -1) {
    return fallback(node, meta);
  }
  return mapMemberProperties([node.base, ...node.properties], meta);
}

function mapLiteral(node: CNode) {
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

function mapKey(node: CNode) {
  const type = node.base.constructor.name;
  if (type === 'Literal') {
    return b.identifier(node.base.value);
  }
}

function mapObjectExpression(node: CNode, meta: Object) {
  return b.objectExpression(node.base.properties.map(property =>
    b.property(
      'init',
      mapExpression(property.variable || property.base, meta),
      mapExpression(property.value || property.base, meta))
  ));
}

function mapArrayExpression(node: CNode, meta: Object) {
  return b.arrayExpression(node.objects.map(expr => mapExpression(expr, meta)));
}

function mapRange(node: CNode, meta: Object) {
  const compiledRange = parse(prettyPrint(parse(node.compile(meta)))).program.body[0];
  return compiledRange.expression;
}

function mapSlice(node: CRange, meta: Object) {
  return b.callExpression(
    b.identifier('slice'),
    [
      mapExpression(node.range.from, meta),
      mapExpression(node.range.to, meta),
    ]
  );
}

function mapValue(node: CNode, meta: Object) {
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

  throw new Error(`can't convert node of type: ${type} to value - not recognized`);
}

function mapOp(node: COp, meta: Object) {
  const {operator} = node;

  if (operator === '%%' && node.second) {
    return b.binaryExpression(
      '%',
      b.parenthesizedExpression(
        b.binaryExpression(
          '+',
          b.binaryExpression(
            '%',
            mapExpression(node.first, meta),
            mapExpression(node.second, meta)
          ),
          mapExpression(node.second, meta)
        )
      ),
      mapExpression(node.second, meta)
    );
  }

  if (operator === '++' || operator === '--') {
    return b.updateExpression(
      operator,
      mapExpression(node.first, meta),
      !node.flip);
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

function mapArguments(args: CArgList, meta: Object) {
  return args.map(arg => {
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

function mapCall(node: CBase, meta: Object) {
  let left;
  const superMethodName = meta.superMethodName;

  if (node.soak === true) {
    const compiled:string = node.compile(meta);
    return
      parse(compiled)
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

function mapAssignment(node: CNode, meta: Object) {
  return b.expressionStatement(mapExpression(node, meta));
}

function mapClassProperty(node: CNode, meta: Object) {
  return b.classProperty(mapExpression(node.variable, meta), mapExpression(node.value, meta), null);
}

function mapClassBodyElement(node: CNode, meta: Object) {
  const superMethodName = node.variable.base.value;
  let elementType = 'method';
  let isStatic = false;

  if (node.variable.this === true) {
    isStatic = true;
    node.variable = get(node, 'variable.properties[0].name');
  }

  if (node.constructor.name === 'Assign' &&
      node.value && node.value.constructor.name !== 'Code') {
    return mapClassProperty(node, meta);
  }

  if (superMethodName === 'constructor') {
    elementType = 'constructor';
  }

  const _meta = Object.assign(
    {},
    meta,
    {superMethodName});

  return b.methodDefinition(
    elementType,
    mapExpression(node.variable, _meta),
    mapExpression(node.value, _meta),
    isStatic
  );
}

function getBoundMethodNames(classElements, meta: Object) {
  return flatten(classElements
      .filter(el => el.base && el.base.properties)
      .map(el => el.base.properties)
    )
    .filter(el => get(el, 'variable.this') !== true &&
      el.value.constructor.name === 'Code' &&
        el.value.bound === true
    ).map(el => mapExpression(el.variable, meta));
}

function unbindMethods(classElements) {
  return classElements.map(el => {
    if (el.value.constructor.name === 'Code') {
      el.value.bound = false;
    }
    return el;
  });
}

function mapStaticClassProperty(node: CNode, meta: Object) {
  return b.classProperty(mapExpression(node.variable.properties[0], meta), mapExpression(node.value, meta), null, true);
}

function mapClassExpressions(expressions, meta: Object) {
  return expressions.reduce((arr, expr) => {
    const type = expr.constructor.name;
    let classElements = [];
    if (type === 'Assign') {
      if (expr.variable && expr.variable.this === true) {
        return arr.concat([mapStaticClassProperty(expr, meta)]);
      }
    } else if (type === 'Value') {
      classElements = expr.base.properties;
      classElements = unbindMethods(classElements);
      classElements = classElements.map(el => mapClassBodyElement(el, meta));
      return arr.concat(classElements);
    }
    return arr;
  }, []);
}

function mapClassBody(node: CBody, meta: Object) {
  const {expressions} = node;
  const boundMethods = getBoundMethodNames(expressions, meta);
  const classElements = mapClassExpressions(expressions, meta);
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
        boundMethods.map(identifier =>
          b.expressionStatement(
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
    );
  }

  return b.classBody(classElements);
}

function mapClassExpression(node: CNode, meta: Object) {
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

function mapClassDeclaration(node: CNode, meta: Object) {
  let parent = null;

  if (get(node, 'variable.properties.length') > 0) {
    return b.expressionStatement(b.assignmentExpression(
      '=',
      mapExpression(node.variable, meta),
      mapClassExpression(Object.assign({}, node, {variable: last(node.variable.properties)}), meta)
    ));
  }

  if (node.parent !== undefined && node.parent !== null) {
    parent = mapExpression(node.parent, meta);
  }

  return b.classDeclaration(
    mapExpression(node.variable, meta),
    mapClassBody(node.body, meta),
    parent
  );
}

function mapElseBlock(node: CNode, meta: Object) {
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

function mapElseExpression(node: CNode, meta: Object) {
  const type = node.constructor.name;

  if (type === 'If') {
    return mapConditionalExpression(node, meta);
  } else if (type === 'Block') {
    return mapExpression(node.expressions[0], meta);
  }

  return mapExpression(node, meta);
}

function mapConditionalExpression(node: CNode, meta: Object) {
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

function mapTryExpression(node: CNode, meta: Object) {
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


function mapIfStatement(node: CNode, meta: Object) {
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

function isStatement(expr) {
  const type = expr.constructor.name;
  switch (type) {
    case 'Literal':
      if (expr.value === 'break' || expr.value === 'continue') {
        return true;
      }
      return false;
    case 'Throw':
    case 'For':
    case 'While':
    case 'Return':
    case 'If':
    case 'Break':
      return true;
    default:
      return false;
  }
}

function mapConditionalStatement(node: CNode, meta: Object) {
  // If the conditional has more than one test
  // or more than one expression in either block we
  // create an if statement otherwise we use a conditional
  // expression

  if (
    node.elseBody && node.elseBody.expressions.length > 1 ||
    node.body && node.body.expressions.length > 1 ||
    node.body && any(node.body.expressions, expr => isStatement(expr)) ||
    node.elseBody && any(node.elseBody.expressions, expr => isStatement(expr))) {
    return mapIfStatement(node, meta);
  }

  return b.expressionStatement(mapConditionalExpression(node, meta));
}

function mapTryCatchBlock(node: CNode, meta: Object) {
  let recovery;
  let errorVar;
  let finalize = null;

  if (node.ensure) {
    finalize = mapBlockStatement(node.ensure, meta);
  }

  if (node.recovery) {
    recovery = mapBlockStatement(node.recovery, meta);
  } else {
    recovery = b.blockStatement([]);
  }

  if (node.errorVariable) {
    errorVar = mapLiteral({base: node.errorVariable}, meta);
  } else {
    errorVar = b.identifier('undefined');
  }

  return b.tryStatement(
    mapBlockStatement(node.attempt, meta),
    b.catchClause(
      errorVar,
      null,
      recovery
    ),
    finalize
  );
}

function mapReturnStatement(node: CNode, meta: Object) {
  return b.returnStatement(node.expression ? mapExpression(node.expression, meta) : null);
}

function mapStatement(node: CNode, meta: Object) {
  const type = node.constructor.name;

  if (type === 'While') {
    return mapWhileLoop(node, meta);
  } else if (type === 'Assign') {
    return mapAssignment(node, meta);
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
    return addBreakStatementsToSwitch(mapSwitchStatement(node, meta));
  } else if (type === 'If') {
    return mapConditionalStatement(node, meta);
  } else if (type === 'Try') {
    return mapTryCatchBlock(node, meta);
  }

  return b.expressionStatement(mapExpression(node, meta));
}

function mapBlockStatements(node: CNode, meta: Object) {
  return node.expressions.map(expr => mapStatement(expr, meta));
}

function mapBlockStatement(node: CNode, meta, factory = b.blockStatement) {
  const block = factory(mapBlockStatements(node, meta));
  return block;
}

function mapInArrayExpression(node: CNode, meta: Object) {
  return b.memberExpression(
    mapExpression(node.array, meta),
    b.callExpression(
      b.identifier('includes'),
      [mapExpression(node.object, meta)]
    )
  );
}

function extractAssignStatementsByArguments(node: CNodes) {
  return nodes
    .map(node => node.type === 'AssignmentExpression' ? node.left : node)
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

function normalizeArguments(node: CNodes) {
  return nodes.map(node => {
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
  });
}

// index can be an expression in this case
function mapArgumentWithExpansion(node: CNode, meta, arg) {
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

function mapSplatArgument(headLength, tailCount) {
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

function mapArgumentsWithExpansion(nodes: CNodeList, meta: Object) {
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
  const expansionIndex = findIndex(nodes, node => node.constructor.name === 'Expansion' || node.splat === true);
  const isSplat = any(nodes, node => node.splat === true);

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
  head.forEach((node, index) => {
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

    if (nodeList[lastIndex].type === 'IfStatement') {
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
  if (nodeList.length > 0) {
    nodeList.push(b.breakStatement());
  }
  return nodeList;
}

function addReturnStatementToIfBlocks(node: CNode) {
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

function addReturnStatementToBlock(node: CNode) {
  const hasReturnStatement = findIndex(node.body, {type: 'ReturnStatement'}) === node.body.length - 1;

  if (hasReturnStatement) {
    return node;
  }
  node.body = lastReturnStatement(node.body);
  return node;
}

function mapFunction(node: CNode, meta: Object) {
  // Function {
  //   params: [],
  //   body: [statements],
  //   bound: Boolean
  // }
  let args = [];
  const isGenerator = node.isGenerator;

  // setupStatements will be appended at the top of the function
  // block. It's used to add behaviour that would be impossible to
  // map 1 to 1 from coffeescript
  let setupStatements = [];

  // Expansions are coffee-script-only behaviour. We'll need to do
  // some plumbing to map Expansions to JavaScript, also we don't
  // want to rely on the coffeescript parser for this as the output
  // is quite weird/ugly
  const hasExpansion = any(node.params, (param, index) =>
    // if the last argument isn't a splat or expansion we needn't worry
    // To spell it out the logic here is:
    // If this isn't the last argument, and
    // the argument is either an expansion or a splat
    // then we return true
    (index < (node.params.length - 1) &&
     (param.constructor.name === 'Expansion' ||
      param.splat === true))
  );

  if (hasExpansion === false) {
    args = mapArguments(node.params, meta);
  }

  if (hasExpansion === true) {
    setupStatements = setupStatements.concat(setupStatements, mapArgumentsWithExpansion(node.params, meta));
  }

  // In coffeescript you can immediately assign an argument to a
  // member of `this`. Which looks like this: fn = (@a = 'A') ->
  // For our compilation we translate it like
  // fn = function() { this.a = arguments[0]; } as there is no 1 to 1
  // solution here
  setupStatements = setupStatements.concat(extractAssignStatementsByArguments(args, meta));

  let block = mapBlockStatement(node.body, meta);
  if (isGenerator === false) {
    block = addReturnStatementToBlock(block, meta);
  }

  block.body = setupStatements.concat(block.body);
  args = normalizeArguments(args, meta);

  if (node.bound === true) {
    return b.arrowFunctionExpression(args, block);
  }

  return b.functionExpression(null, args, block, isGenerator);
}

function getStatement(node: CNode) {
  if (n.Statement.check(node.value) !== true && node.parent) {
    return getStatement(node.parent);
  }
  return node;
}

function inParentScope(path, filter) {
  if (typeof filter !== 'function') {
    throw new Error('filter argument must be function');
  }
  const statement = getStatement(path);
  const scope = jsc(path).closestScope().paths()[0];
  let statementsInScope;

  if (n.Program.check(scope.value)) {
    statementsInScope = scope.value.body;
  } else if (n.FunctionExpression.check(scope.value) ||
      n.ArrowFunctionExpression.check(scope.value) ||
      n.CatchClause.check(scope.value)) {
    statementsInScope = scope.value.body.body;
  } else {
    throw new Error(`Can't recognize scope container of type ${scope.value.type}`);
  }

  const indexInScope = findIndex(statementsInScope, node =>
    statement.value === node
  );

  const statements = statementsInScope.slice(0, indexInScope).filter(filter);
  const scopeStatement = getStatement(scope);

  if (n.Program.check(scope.value)) {
    return statements;
  }
  return inParentScope(scope.parent, filter).concat(
    [scopeStatement]
      .filter(_s => _s !== null)
      .map(_s => _s.value)
      .filter(filter)
  ).concat(statements);
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
          b.expressionStatement(b.callExpression(b.identifier('super'), [])));
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

function insertVariableDeclarations(ast) {
  jsc(ast)
  .find(jsc.AssignmentExpression, node =>
    n.MemberExpression.check(node.left) !== true &&
    get(node, 'operator') === '='
  )
  .filter(path => {
    const needle = {type: 'Identifier', name: path.value.left.name};

    const catchClauseParam = get(path, 'parent.parent.parent.value.param');

    if (get(path, 'parent.parent.parent.value.type') === 'CatchClause' &&
      get(catchClauseParam, 'name') === needle.name) {
      return false;
    }

    const shadowedVariables = inParentScope(path, node => {
      if (n.VariableDeclaration.check(node)) {
        return findIndex(node.declarations, {id: needle}) > -1;
      }

      if ((n.MethodDefinition.check(node) || n.FunctionExpression.check(node.value)) &&
          node.value &&
          (findIndex(node.value.params, {left: needle}) > -1 ||
          findIndex(node.value.params, needle)) > -1) {
        return true;
      }

      if (n.ExpressionStatement.check(node)) {
        if ((n.FunctionExpression.check(node.expression) || n.ArrowFunctionExpression.check(node.expression)) &&
            findIndex(node.expression.params, needle) > -1) {
          return true;
        }

        if (n.AssignmentExpression.check(node.expression)) {
          if (node.expression.left.name === path.value.left.name) {
            return true;
          } else if (n.FunctionExpression.check(node.expression.right) ||
                     n.ArrowFunctionExpression.check(node.expression.right)) {
            if (findIndex(node.expression.right.params, needle) > -1) {
              return true;
            } else if (findIndex(node.expression.right.params,
                                 {type: 'AssignmentExpression', left: {name: path.value.left.name}}) > -1) {
              return true;
            }
          }
        }
      }

      if (n.ReturnStatement.check(node)) {
        if (n.AssignmentExpression.check(node.argument)) {
          return node.argument.left.name === path.value.left.name;
        }
      }
      return false;
    });

    return shadowedVariables.length < 1;
  })
  .forEach(path => {
    if (path.parent && path.parent.value.type === 'ExpressionStatement') {
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
      let body = jsc(path).closestScope().nodes()[0].body;
      if (body.body !== undefined) {
        body = body.body;
      }
      body.unshift(
        b.variableDeclaration(
          'var',
          [b.variableDeclarator(path.value.left, null)]
        )
      );
    }
  });

  return ast;
}

function mapSwitchCases(cases, meta: Object) {
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

function mapSwitchStatement(node: CNode, meta: Object) {
  let cases = [];

  if (node.cases && node.cases.length > 0) {
    cases = cases.concat(node.cases);
  }

  if (node.otherwise) {
    cases.push([null, node.otherwise]);
  }

  return b.switchStatement(
    mapExpression(node.subject, meta),
    mapSwitchCases(cases, meta)
  );
}

function mapForStatement(node: CNode, meta: Object) {
  if (node.object === false) {
    return b.forInStatement(
      b.variableDeclaration(
        'let',
        [b.variableDeclarator(mapExpression(node.name, Object.assign({}, meta, { left: true })), null)]
      ),
      mapExpression(node.source, meta),
      mapBlockStatement(node.body, meta)
    );
  } else if (node.object === true) {
    const args =
      b.arrayPattern(
        pluck(node, ['index', 'name'])
        .filter(expr => !!expr)
        .map(expr => mapExpression(expr, meta)));
    return b.forInStatement(
      b.variableDeclaration(
        'let',
        [
          b.variableDeclarator(args, null),
        ]
      ),
      b.memberExpression(
        b.identifier('Object'),
        b.callExpression(
          b.identifier('entries'),
          [
            mapExpression(node.source, meta),
          ]
        )
      ),
      mapBlockStatement(node.body, meta)
    );
  }
}

function mapLeftHandForExpression(node: CNode, meta: Object) {
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
              parse('return _i === 0 || _i % (2 + 1) == 0;').program.body
            )
          ),
        ]
      )
    );
  }

  return mapExpression(node.source, meta);
}

function mapForExpression(node: CNode, meta: Object) {
  const leftHand = mapLeftHandForExpression(node, meta);
  return b.memberExpression(
    leftHand,
    b.callExpression(
      b.identifier('map'),
      [
        b.arrowFunctionExpression(
          [mapExpression(node.name, meta)],
          addReturnStatementToBlock(mapBlockStatement(node.body, meta))
        ),
      ]
    )
  );
}

function mapSplatParam(node: CNode, meta: Object) {
  return b.restElement(mapExpression(node, meta));
}

function mapParam(node: CNode, meta: Object) {
  if (node.value !== undefined && node.value !== null) {
    return mapExpression(mapParamToAssignment(node), meta);
  } else if (node.splat === true) {
    return mapSplatParam(node.name, meta);
  }
  return mapExpression(node.name, meta);
}

function mapSplat(node: CNode, meta: Object) {
  return b.spreadElement(mapExpression(node.name, meta));
}

function addReturnStatementsToSwitch(node: CNode) {
  node.cases = node.cases.map(switchCase => {
    switchCase.consequent = lastReturnStatement(switchCase.consequent);
    return switchCase;
  });
  return node;
}

function addBreakStatementsToSwitch(node: CNode) {
  node.cases = node.cases.map(switchCase => {
    if (switchCase.test !== null) {
      switchCase.consequent = lastBreakStatement(switchCase.consequent);
    }
    return switchCase;
  });
  return node;
}

function mapSwitchExpression(node: CNode, meta: Object) {
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

function fallback(node: CNode, meta: Object) {
  const compiled = node.compile(meta);
  return parse(prettyPrint(
    parse(compiled), meta.options)).program.body[0].expression;
}

function mapExistentialExpression(node: CNode, meta: Object) {
  return fallback(node, meta);
}

function mapNewExpression(node: CNode, meta: Object) {
  const constructor = node.first || node.variable;
  const args = node.args ? mapArguments(node.args, meta) : [];
  return b.newExpression(mapExpression(constructor, meta), args);
}

function conditionalStatementAsExpression(node: CNode, meta: Object) {
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

// function mapComment(node: CNode) {
//   const comment = b.block(node.comment);
//   return comment;
// }

function mapWhileLoop(node: CNode, meta: Object) {
  return b.whileStatement(
    mapExpression(node.condition, meta),
    mapBlockStatement(node.body, meta));
}

function mapThrowStatement(node: CNode, meta: Object) {
  return b.throwStatement(mapExpression(node.expression, meta));
}

function mapWhileExpression(node: CNode, meta: Object) {
  return fallback(node, meta);
}

function mapYieldExpression(node: CNode, meta: Object) {
  return b.yieldExpression(mapExpression(node.first, meta));
}

function mapExpression(node: CNode | CBase, meta: Object): JSNode {
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

function mapParamToAssignment(node: CNode) {
  const assignment = {
    variable: node.name,
    value: node.value,
  };
  assignment.constructor = {name: 'Assign'};
  return assignment;
}

function mapAssignmentExpression(node: CNode, meta: Object) {
  let variable;
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

function mapObjectPatternItem(node: CBase, meta: Object) {
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

function mapObjectPattern(nodes: CBaseList, meta: Object) {
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

function mapArrayPattern(node: CBase, meta: Object) {
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

function mapAssignmentPattern(node: CNodeList, meta: Object) {
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

export function transpile(ast, meta: Object) {
  if (meta === undefined) {
    meta = {};
  }

  if (!meta.scope) {
    meta.scope = new Scope(null, coffeeParse, null, []);
    meta.indent = ' ';
  }

  const program = mapBlockStatement(ast, meta, b.program);
  return program;
}

export function compile(source, opts, parse = coffeeParse) {
  const doubleSemicolon = /\;+/g;
  opts = opts || {tabWidth: 2, quote: 'double'};

  const _compile = compose(
    // hack because of double semicolon
    compiledSource => Object.assign({}, compiledSource, {code: compiledSource.code.replace(doubleSemicolon, ';')}),
    jsAst => print(jsAst, opts),
    insertSuperCalls,
    insertVariableDeclarations,
    csAst => transpile(csAst, {options: opts}),
    parse);

  return _compile(source).code;
}
