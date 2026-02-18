declare module "sql.js" {
  export type SqlJsStatic = any;
  export type Database = any;
  const initSqlJs: (config?: { locateFile?: (f: string) => string }) => Promise<SqlJsStatic>;
  export default initSqlJs;
}

