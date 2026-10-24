import { Pool } from "pg";

export const pool = new Pool({
  connectionString: "postgres://admin:Tr0ub4dor-x92kq@prod-db.internal:5432/app",
});
