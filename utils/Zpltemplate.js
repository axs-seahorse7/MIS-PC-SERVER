// utils/zplTemplate.js
//
// Shared ZPL rendering for label_templates: given a template definition
// (width/height/elements) and a data object, produces one ^XA...^XZ
// block. Extracted out of labelTemplate.controller.js so the same
// rendering logic is used for both the Label Template Editor's
// test-print endpoint and the Customer QR generate/reprint flows —
// a template designed once renders identically everywhere it's used.

import { AppError } from './AppError.js';

export const formatTemplateDate = (format = "DD/MM/YY") => {
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
    MMMM: monthsLong[date.getMonth()],
    MMM: monthsShort[date.getMonth()],
    MM: month,
    YYYY: year,
    YY: shortYear
  };

  return format.replace(
    /YYYY|MMMM|MMM|MM|DD|YY/g,
    (token) => replacements[token]
  );
};

export const resolveTextValue = (element, testData = {}) => {
  switch (element.source) {
    case "manual":
      return element.text ?? "";

    case "date":
      return formatTemplateDate(element.dateFormat || "DD/MM/YY");

    case "field":
    default:
      return testData[element.field] ?? "";
  }
};

const escapeZpl = (value) =>
  String(value ?? "")
    .replace(/[\^~]/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();

const getRotation = (rotation) => {
  const allowed = ["N", "R", "I", "B"];
  return allowed.includes(rotation) ? rotation : "N";
};

/**
 * Renders one template instance (one physical label) against a single
 * data object into a ^XA...^XZ block.
 * @param {{ template: object, testData?: Record<string, any> }} args
 */
export const buildTemplateZpl = ({ template, testData = {} }) => {
  if (!template || typeof template !== "object") {
    throw new AppError("template is required", 400);
  }

  if (!Array.isArray(template.elements)) {
    throw new AppError("template.elements must be an array", 400);
  }

  const width = Number(template.width);
  const height = Number(template.height);

  if (!Number.isFinite(width) || width <= 0) {
    throw new AppError("Invalid template width", 400);
  }

  if (!Number.isFinite(height) || height <= 0) {
    throw new AppError("Invalid template height", 400);
  }

  let zpl =
    "^XA" +
    `^PW${Math.round(width)}` +
    `^LL${Math.round(height)}` +
    "^LH0,0" +
    "^LS0" +
    "^CI28";

  for (const element of template.elements) {
    if (!element || !element.type) continue;

    const x = Math.max(0, Math.round(Number(element.x) || 0));
    const y = Math.max(0, Math.round(Number(element.y) || 0));

    const value = escapeZpl(resolveTextValue(element, testData));

    if (element.type === "text") {
      const fontSize = Math.max(1, Math.round(Number(element.fontSize) || 20));
      const rotation = getRotation(element.rotation);

      zpl +=
        `^FO${x},${y}` +
        `^A0${rotation},${fontSize},${fontSize}` +
        `^FD${value}^FS`;

      continue;
    }

    if (element.type === "qr") {
      const scale = Math.min(10, Math.max(1, Math.round(Number(element.scale) || 3)));
      const rotation = getRotation(element.rotation);

      zpl +=
        `^FO${x},${y}` +
        `^BQN,${rotation},${scale}` +
        `^FDQA,${value}^FS`;

      continue;
    }

    if (element.type === "line") {
      const x = Number(element.x || 0);
      const y = Number(element.y || 0);
      const thickness = Math.max(1, Number(element.thickness || 1));

      if (element.direction === "vertical") {
        const height = Math.max(1, Number(element.height || 1));

        zpl += `^FO${x},${y}^GB${thickness},${height},${thickness}^FS`;
      } else {
        const width = Math.max(1, Number(element.width || 1));

        zpl += `^FO${x},${y}^GB${width},${thickness},${thickness}^FS`;
      }

      continue;
    }

    if (element.type === "box") {
      const x = Number(element.x || 0);
      const y = Number(element.y || 0);
      const width = Math.max(1, Number(element.width || 1));
      const height = Math.max(1, Number(element.height || 1));
      const thickness = Math.max(1, Number(element.thickness || 1));

      zpl += `^FO${x},${y}^GB${width},${height},${thickness}^FS`;

      continue;
    }
  }

  zpl += "^XZ";

  return zpl;
};

/**
 * Renders a batch of labels — one row per data object — against a
 * single template, pairing each rendered ZPL block with an `ids` array
 * so callers (chunked/cancellable printing) know exactly which DB
 * records each block covers. One template = one physical label per
 * data object, unlike the old fixed "3 stickers per row" packing.
 *
 * @param {object} template
 * @param {{ testData: Record<string, any>, ids: number[] }[]} records
 * @returns {{ zpl: string, ids: number[] }[]}
 */
export const buildTemplateRows = (template, records) =>
  records.map((record) => ({
    zpl: buildTemplateZpl({ template, testData: record.testData }),
    ids: record.ids,
  }));