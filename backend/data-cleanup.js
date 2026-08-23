const fs = require('fs');
const path = require('path');

function clearDirectory(dir) {
  if (!fs.existsSync(dir)) return 0;
  let deleted = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
    deleted += 1;
  }
  return deleted;
}

function clearOldData(caseDir, reportDir) {
  const deletedCases = clearDirectory(caseDir);
  const deletedReports = clearDirectory(reportDir);
  return { deletedCases, deletedReports, totalDeleted: deletedCases + deletedReports, resetAt: new Date().toISOString() };
}

module.exports = { clearOldData };