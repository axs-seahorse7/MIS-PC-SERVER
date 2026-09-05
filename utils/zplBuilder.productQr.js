// utils/zplBuilder.productQr.js

const escapeZpl = (value = "") =>
  String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\^/g, " ")
    .replace(/~/g, " ");

const formatTemplateDate = (format = "DD/MM/YY") => {
  const now = new Date();

  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  const yy = yyyy.slice(-2);

  switch (format) {
    case "DD/MM/YYYY":
      return `${dd}/${mm}/${yyyy}`;

    case "DD/MM/YY":
      return `${dd}/${mm}/${yy}`;

    case "DD-MM-YYYY":
      return `${dd}-${mm}-${yyyy}`;

    case "DD-MM-YY":
      return `${dd}-${mm}-${yy}`;

    case "YYYY-MM-DD":
      return `${yyyy}-${mm}-${dd}`;

    default:
      return `${dd}/${mm}/${yy}`;
  }
};

const resolveTextValue = (element, data = {}) => {
  switch (element.source) {
    case "manual":
      return element.text ?? "";

    case "date":
      return formatTemplateDate(
        element.dateFormat || "DD/MM/YY"
      );

    case "field":
    default:
      return data[element.field] ?? "";
  }
};

const buildTemplateCellZpl = (template, data, offsetX = 0) => {
  const elements = Array.isArray(template.elements)? template.elements : [];


  return elements.map((element) => {
      const x = Number(offsetX) + Number(element.x || 0);
      const y =Number(element.y || 0);

      // ----------------------------------------------------------
      // TEXT
      // ----------------------------------------------------------

      if (element.type === "text") {
        const value = escapeZpl(resolveTextValue(element, data));
        if (!value) return "";

        const fontSize = Math.max(1, Number(element.fontSize || 20));
        const rotation = Number(element.rotation || 0);
        const orientation = rotation === 90? "R" : rotation === 180? "I"
              : rotation === 270? "B" : "N";

        const font = element.bold ? "0" : "A";

        return (
          `^FO${x},${y}` +
          `^A${font}${orientation},${fontSize},${fontSize}` +
          `^FD${value}^FS`
        );
      }

      // ----------------------------------------------------------
      // QR
      // ----------------------------------------------------------

      if (element.type === "qr") {
        const value = escapeZpl(data[element.field] ?? "");
        if (!value) return "";

        const scale = Math.min(10, Math.max(1, Number(element.scale || 3)));
       
        return (
          `^FO${x},${y}` +
          `^BQN,2,${scale}` +
          `^FDLA,${value}^FS`
        );
      }

      return "";
    })
    .filter(Boolean)
    .join("");
};

// ---------------------------------------------------------------------
// Build one row of Product QR labels
// ---------------------------------------------------------------------

export const buildProductQrRowZpl = (
  template,
  labels
) => {
  if (!template) {
    throw new Error(
      "Product QR template is required"
    );
  }

  if (!Array.isArray(labels) || !labels.length) {
    throw new Error(
      "At least one product label is required"
    );
  }

  const width = Number(template.width);
  const pitchY = Number(template.pitch_y);

  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(
      "Invalid Product QR template width"
    );
  }

  if (!Number.isFinite(pitchY) || pitchY <= 0) {
    throw new Error(
      "Invalid Product QR template pitch_y"
    );
  }

  const pitchX = Number(template.pitch_x);

  if (!Number.isFinite(pitchX) || pitchX <= 0) {
    throw new Error(
      "Invalid Product QR template pitch_x"
    );
  }

  let zpl =
    "^XA" +
    `^PW${width}` +
    `^LL${pitchY}` +
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

// ---------------------------------------------------------------------
// Build complete Product QR batch ZPL
//
// Example:
// width     = 1200
// pitch_x   = 400
//
// → 3 labels per row
// ---------------------------------------------------------------------

export const buildProductQrBatchZpl = (template,labels) => {
  if (!template) {
    throw new Error("Product QR template is required");
  }

  if (!Array.isArray(labels) || !labels.length) {
    throw new Error("At least one product label is required");
  }

  const width = Number(template.width);
  const pitchX = Number(template.pitch_x);

  if (!Number.isFinite(width) || width <= 0) {
    throw new Error("Invalid Product QR template width");
  }

  if (!Number.isFinite(pitchX) || pitchX <= 0) {
    throw new Error("Invalid Product QR template pitch_x");
  }

  const columns = Math.max(1, Math.floor(width / pitchX));

  const rows = [];

  for (let i = 0; i < labels.length; i += columns) {
    rows.push(labels.slice(i, i + columns));
  }

  return rows
    .map((row) =>
      buildProductQrRowZpl(
        template,
        row
      )
    )
    .join("\n");
};