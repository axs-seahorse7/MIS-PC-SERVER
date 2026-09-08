const escapeZpl = (value) =>
  String(value ?? "")
    .replace(/[\^~]/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();

const getRotation = (rotation) => {
  const deg = Number(rotation) || 0;
  if (deg === 90) return "R";
  if (deg === 180) return "I";
  if (deg === 270) return "B";
  return "N";
};

const formatTemplateDate = (format = "DD/MM/YY") => {
  const date = new Date();

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  const shortYear = year.slice(-2);

  const monthsShort = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  const monthsLong = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const replacements = {
    DD: day,
    MM: month,
    YY: shortYear,
    YYYY: year,
    MMM: monthsShort[date.getMonth()],
    MMMM: monthsLong[date.getMonth()],
  };

  return String(format).replace(
    /YYYY|MMMM|MMM|MM|DD|YY/g,
    (token) => replacements[token]
  );
};

const resolveElementValue = (element, data = {}) => {
  if (element.type === "text") {
    if (element.source === "manual") {
      return element.text ?? "";
    }

    if (element.source === "date") {
      return formatTemplateDate(
        element.dateFormat || "DD/MM/YY"
      );
    }

    if (element.source === "field") {
      return data[element.field] ?? "";
    }

    return "";
  }

  if (element.type === "qr") {
    return data[element.field] ?? "";
  }

  return "";
};

/**
 * Render ONE label cell.
 *
 * offsetX is the physical pitch position of the label.
 *
 * Example:
 *   label 1 -> offsetX 0
 *   label 2 -> offsetX 400
 *   label 3 -> offsetX 800
 */
const buildTemplateCellZpl = (
  template,
  data,
  offsetX = 0
) => {
  let zpl = "";

  for (const element of template.elements || []) {
    if (!element || !element.type) continue;

    const elementX = Math.max(
      0,
      Math.round(Number(element.x) || 0)
    );

    const elementY = Math.max(
      0,
      Math.round(Number(element.y) || 0)
    );

    // IMPORTANT:
    // Only add the physical label pitch here.
    // No extra margin/gap is added.
    const x = Math.round(offsetX + elementX);
    const y = elementY;

    const rotation = getRotation(element.rotation);
    const value = escapeZpl(
      resolveElementValue(element, data)
    );

    // ----------------------------------------------------------
    // TEXT
    // ----------------------------------------------------------

    if (element.type === "text") {
      const fontSize = Math.max(
        1,
        Math.round(Number(element.fontSize) || 20)
      );

      zpl +=
        `^FO${x},${y}` +
        `^A0${rotation},${fontSize},${fontSize}` +
        `^FD${value}^FS`;

      continue;
    }

    // ----------------------------------------------------------
    // QR
    // ----------------------------------------------------------

    if (element.type === "qr") {
      const scale = Math.min(
        10,
        Math.max(
          1,
          Math.round(Number(element.scale) || 3)
        )
      );

      zpl +=
        `^FO${x},${y}` +
        `^BQN,${rotation},${scale}` +
        `^FDQA,${value}^FS`;

      continue;
    }
  }

  return zpl;
};

/**
 * Build ONE horizontal row.
 *
 * The row is divided strictly according to pitch_x.
 *
 * Example:
 *   width   = 1200
 *   pitch_x = 400
 *
 *   label 1 = 0
 *   label 2 = 400
 *   label 3 = 800
 */
export const buildCustomerQrRowZpl = (
  template,
  labels
) => {
  if (!template || !Array.isArray(template.elements)) {
    return "";
  }

  if (!Array.isArray(labels) || !labels.length) {
    return "";
  }

  const width = Math.round(Number(template.width));
  const height = Math.round(Number(template.pitch_y));

  const pitchX = Math.round(Number(template.pitch_x));

  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0 ||
    !Number.isFinite(pitchX) ||
    pitchX <= 0
  ) {
    return "";
  }

  let zpl =
    "^XA" +
    `^PW${width}` +
    `^LL${height}` +
    "^LH0,0" +
    "^LS0" +
    "^CI28";

  labels.forEach((label, index) => {
    const offsetX = index * pitchX;

    zpl += buildTemplateCellZpl(
      template,
      label,
      offsetX
    );
  });

  zpl += "^XZ";

  return zpl;
};

/**
 * Build the complete Customer QR batch.
 *
 * Labels are packed horizontally:
 *
 * [1][2][3]
 * [4][5][6]
 * [7][8][9]
 */
export const buildCustomerQrBatchZpl = (
  template,
  labels
) => {
  if (!template || !Array.isArray(labels) || !labels.length) {
    return "";
  }

  const width = Math.round(Number(template.width));
  const pitchX = Math.round(Number(template.pitch_x));
  const pitchY = Math.round(Number(template.pitch_y));

  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(pitchX) ||
    pitchX <= 0 ||
    !Number.isFinite(pitchY) ||
    pitchY <= 0
  ) {
    return "";
  }

  const columns = Math.max(
    1,
    Math.floor(width / pitchX)
  );

  let zpl = "";

  for (let i = 0; i < labels.length; i += columns) {
    const rowLabels = labels.slice(
      i,
      i + columns
    );

    zpl += buildCustomerQrRowZpl(
      template,
      rowLabels
    );

    if (i + columns < labels.length) {
      zpl += "\n";
    }
  }

  return zpl;
};