const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'LIMIT', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'ON',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'HAVING', 'WITH', 'DISTINCT', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END', 'DESC', 'ASC', 'UNION', 'ALL', 'LIKE', 'BETWEEN', 'OVER', 'PARTITION', 'OFFSET', 'CAST', 'FLOAT',
  'INTEGER', 'TEXT', 'DATE', 'INTERVAL', 'EXISTS', 'ILIKE', 'TRUE', 'FALSE', 'FILTER', 'ROWS', 'RANGE',
]);
const FUNCTIONS = /^(SUM|AVG|COUNT|MIN|MAX|ROUND|STRFTIME|DATE_TRUNC|TO_CHAR|DATE_FORMAT|COALESCE|LOWER|UPPER|YEAR|MONTH|QUARTER|CONCAT|SUBSTR|LENGTH|ABS|NULLIF|EXTRACT|DATE|JULIANDAY|ROW_NUMBER|RANK|DENSE_RANK|LAG|LEAD|PERCENTILE_CONT|MEDIAN|IFNULL|TRIM|REPLACE|CEIL|FLOOR)$/i;

const TOKEN = /(--[^\n]*)|('(?:[^']|'')*')|("(?:[^"]|"")*"|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|(.)/g;

export function highlightSql(sql = '') {
  const out = [];
  let m;
  let i = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(sql))) {
    const [text, comment, str, quoted, num, word] = m;
    let cls = '';
    if (comment) cls = 'tok-comment';
    else if (str) cls = 'tok-str';
    else if (quoted) cls = 'tok-ident';
    else if (num) cls = 'tok-num';
    else if (word) {
      if (KEYWORDS.has(word.toUpperCase())) cls = 'tok-kw';
      else if (FUNCTIONS.test(word) && sql[TOKEN.lastIndex] === '(') cls = 'tok-fn';
    }
    out.push(cls ? <span key={i++} className={cls}>{text}</span> : text);
  }
  return out;
}
