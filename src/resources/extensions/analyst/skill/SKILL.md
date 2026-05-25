---
name: data-analyst
description: Use when the user wants to retrieve, analyze, summarize, or report on data, such as "analyze this CSV", "build me a dashboard", or "what are the trends in this file". Drives the ingest -> SQL analysis -> deliverable workflow.
---

# Data Analyst Workflow

When the user wants insight from a data file, follow this loop. Do not answer from memory; compute against the real data.

1. Ingest. Call `ingest` with the absolute path to the user's file. Read the returned schema and sample so you understand the real columns and types.
2. Analyze. Use the `scratchpad` tool with SQL against the ingested table. Prefer aggregation (`GROUP BY`, window functions) over dumping raw rows. Iterate: inspect results, refine the query.
3. Deliver. When you have the result the user wants:
   - For a chart or dashboard: call `create_deliverable` with type `html-app`, then write a self-contained `dashboard.html` into the returned folder.
   - For a written summary: use type `document` and write `report.md`.
   - For cleaned data: use type `dataset` and write the CSV or Parquet output.
4. Tell the user where it is and that they can open, reveal, or export it from `/deliverables`.

Long analyses run in the background automatically when you set a realistic time estimate. Keep the user informed and continue when results arrive.
