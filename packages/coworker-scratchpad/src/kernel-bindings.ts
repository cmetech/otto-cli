import pl from 'nodejs-polars';
import ExcelJS from 'exceljs';
import lodash from 'lodash';
import axios from 'axios';
import { z } from 'zod';
import * as dateFns from 'date-fns';
import * as DuckDB from '@duckdb/node-api';

/**
 * The data libraries pre-bound into every scratchpad cell's vm sandbox.
 * DuckDB is bound as an in-memory-capable lib here; on-disk kernel.db wiring is 1d2.
 */
export function buildDataLibBindings(): Record<string, unknown> {
  return {
    polars: pl,
    DuckDB,
    ExcelJS,
    dateFns,
    lodash,
    zod: z,
    axios,
  };
}
