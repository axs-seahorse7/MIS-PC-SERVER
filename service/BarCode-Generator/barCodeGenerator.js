const DATE_PARTS = ["YYYY", "YY", "MM", "DD", "WW"];

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function formatDatePart(part, date) {
  switch (part) {
    case "YYYY":
      return String(date.getFullYear());
    case "YY":
      return String(date.getFullYear()).slice(-2);
    case "MM":
      return String(date.getMonth() + 1).padStart(2, "0");
    case "DD":
      return String(date.getDate()).padStart(2, "0");
    case "WW":
      return String(getISOWeek(date)).padStart(2, "0");
    default:
      return "";
  }
}

// Key representing "which date bucket are we in right now", derived from
// every DATE segment in the rule. Used to detect month/week/day rollover
// so the serial counter knows when to reset back to `start`. Rules with
// no DATE segment never reset — they just keep counting up forever.
function computeResetKey(segments, date) {
  const dateSegments = segments.filter((s) => s.type === "DATE");
  if (!dateSegments.length) return null;
  return dateSegments.map((seg) => seg.parts.map((p) => formatDatePart(p, date)).join("")).join("|");
}

function renderBarcode(segments, serialValue, date) {
  return segments
    .map((seg) => {
      if (seg.type === "STATIC") return seg.value || "";
      if (seg.type === "DATE") return (seg.parts || []).map((p) => formatDatePart(p, date)).join("");
      if (seg.type === "SERIAL") return String(serialValue).padStart(seg.width, "0");
      return "";
    })
    .join("");
}

/**
 * Generates the next barcode for a packaging_config rule and atomically
 * advances its counter. MUST be called with a connection that already has
 * an open transaction — this issues a `FOR UPDATE` lock on the config row
 * to serialize concurrent packaging scans for the same product/stage.
 *
 * Throws if the rule's serial range is exhausted (current issue value
 * would exceed the configured `end`) — this surfaces as a normal error up
 * through processPackagingScan's transaction, which will roll back and
 * bubble a message telling the operator the rule needs attention.
 */
async function generateNextBarcode(conn, packagingConfigId) {
  const [rows] = await conn.query(
    `SELECT id, barcode_rule, current_serial, serial_reset_key
     FROM packaging_config
     WHERE id = ?
     FOR UPDATE`,
    [packagingConfigId]
  );

  if (!rows.length) {
    throw new Error(`Packaging config ${packagingConfigId} not found`);
  }

  const config = rows[0];
  // mysql2 auto-parses JSON columns, but guard in case it comes back as a string.
  const segments =
    typeof config.barcode_rule === "string" ? JSON.parse(config.barcode_rule) : config.barcode_rule;

  if (!Array.isArray(segments) || !segments.length) {
    throw new Error(`Packaging config ${packagingConfigId} has no barcode_rule configured`);
  }

  const serialSegment = segments.find((s) => s.type === "SERIAL");
  if (!serialSegment) {
    throw new Error(`Packaging config ${packagingConfigId}'s barcode_rule has no SERIAL segment`);
  }

  const now = new Date();
  const resetKey = computeResetKey(segments, now);

  // current_serial holds the NEXT value to issue. Reset to `start` if the
  // date bucket has changed since the last issue (or if this is the very
  // first issue and current_serial hasn't been touched since creation).
  let nextSerial = Number(config.current_serial);
  const needsReset = resetKey !== null && resetKey !== config.serial_reset_key;

  if (needsReset) {
    nextSerial = Number(serialSegment.start);
  }

  if (nextSerial > Number(serialSegment.end)) {
    throw new Error(
      `Barcode serial range exhausted for packaging config ${packagingConfigId} ` +
        `(configured range ${serialSegment.start}–${serialSegment.end}). Update the packaging rule.`
    );
  }

  const barcodeValue = renderBarcode(segments, nextSerial, now);

  await conn.query(
    `UPDATE packaging_config
     SET current_serial = ?, serial_reset_key = ?, updated_at = NOW()
     WHERE id = ?`,
    [nextSerial + 1, resetKey, packagingConfigId]
  );

  return barcodeValue;
}

export {
    generateNextBarcode,
    renderBarcode,
    computeResetKey,
    formatDatePart
};