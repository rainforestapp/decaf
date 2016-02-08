declare module 'ast-types' {
  declare var builders: any;
  declare var namedTypes: any;
}

declare module 'recast' {
  declare function parse(source: string): any;
  declare function print(ast: any): any;
  declare function prettyPrint(ast: any): any;
}

declare module 'coffee-script/lib/coffee-script/scope' {
  declare var Scope: any;
}

declare module 'coffee-script' {
  declare function nodes(source: string): any;
}

declare module 'coffee-script/lib/coffee-script/scope' {
  declare var Scope: any;
}

declare module 'noop' {
  declare function exports(params: any): any;
}
