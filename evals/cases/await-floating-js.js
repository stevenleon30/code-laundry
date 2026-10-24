async function writeAudit(entry) {
  await fetch("/audit", { method: "POST", body: JSON.stringify(entry) });
}

function deleteAccount(id) {
  writeAudit({ action: "delete", id });
  return { deleted: id };
}

module.exports = { deleteAccount };
