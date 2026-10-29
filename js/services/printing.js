// Printing. Two paths:
//   1. Browser print: the receipt HTML goes into a print area and window.print() runs. print.css sizes it to 58 mm or 80 mm.
//   2. Bluetooth thermal printer (Web Bluetooth, ESC/POS). The receipt is drawn on a canvas, so Urdu text
//      (Noto Nastaliq) prints correctly, then sent as a 1-bit raster image.
// The Bluetooth path needs Chrome or Edge on a secure origin, and a printer that exposes a writable GATT
// characteristic. It has not been tested against real hardware in this build.
import { receiptHtml } from './receipt.js';

const CANDIDATE_SERVICES = [0x18f0, 0xff00, 0xffe0, 0xfff0, 0x180a, 0x1801];
const CHUNK = 120;
const DELAY_MS = 20;

let device = null;
let characteristic = null;

export const bluetoothSupported = () => typeof navigator !== 'undefined' && 'bluetooth' in navigator;

/** Prints the receipt through the browser's print dialog. */
export function printInBrowser(model) {
  let area = document.getElementById('print-area');
  if (!area) {
    area = document.createElement('div');
    area.id = 'print-area';
    area.style.display = 'none'; // shown only by the print stylesheet
    document.body.appendChild(area);
  }
  area.innerHTML = receiptHtml(model);
  area.dataset.width = String(model.width);
  const done = () => {
    area.innerHTML = '';
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

/** Asks for a printer, then keeps the writable characteristic for later prints. */
export async function connectBluetoothPrinter() {
  if (!bluetoothSupported()) throw new Error('bluetooth-unsupported');
  device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: CANDIDATE_SERVICES.map((id) => (id === 0x180a || id === 0x1801 ? id : `0000${id.toString(16)}-0000-1000-8000-00805f9b34fb`)),
  });
  device.addEventListener('gattserverdisconnected', () => {
    characteristic = null;
  });
  const server = await device.gatt.connect();
  for (const id of CANDIDATE_SERVICES) {
    const uuid = id === 0x180a || id === 0x1801 ? id : `0000${id.toString(16)}-0000-1000-8000-00805f9b34fb`;
    try {
      const service = await server.getPrimaryService(uuid);
      const found = await service.getCharacteristics();
      const writable = found.find((c) => c.properties.write || c.properties.writeWithoutResponse);
      if (writable) {
        characteristic = writable;
        return device.name ?? 'printer';
      }
    } catch {
      /* this service is not on the printer */
    }
  }
  throw new Error('no-writable-characteristic');
}

export const printerConnected = () => Boolean(characteristic);

async function send(bytes) {
  if (!characteristic) throw new Error('printer-not-connected');
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const part = bytes.slice(i, i + CHUNK);
    if (characteristic.properties.writeWithoutResponse) await characteristic.writeValueWithoutResponse(part);
    else await characteristic.writeValue(part);
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
}

/** Draws the receipt on a canvas as black text on white, using the Urdu-capable font. Returns the canvas. */
export async function renderReceiptCanvas(model) {
  const dots = model.width === 58 ? 384 : 576;
  const scale = 1;
  const font = '"Noto Nastaliq Urdu", "Inter", system-ui, sans-serif';
  try {
    await document.fonts?.load(`22px ${font}`);
  } catch {
    /* fonts unavailable: the fallback face is used */
  }

  const pad = 12;
  const lineHeight = 30;
  const lines = [];
  const push = (text, opts = {}) => lines.push({ text: String(text ?? ''), ...opts });
  push(model.pharmacyName, { center: true, bold: true, size: 26 });
  push(`${model.number}   ${model.date}`);
  if (model.customer) push(`Customer: ${model.customer}`);
  if (model.patient) push(`Patient: ${model.patient}`);
  if (model.doctor) push(`Doctor: ${model.doctor}`);
  push('-'.repeat(dots > 400 ? 46 : 30));
  for (const item of model.items) {
    push(`${item.name} ${item.strength}`.trim(), { bold: true });
    push(`${item.qty}   ${item.amount}`);
    if (item.batches) push(`Batch: ${item.batches}`, { size: 20 });
    if (item.directions) push(item.directions, { size: 20 });
  }
  push('-'.repeat(dots > 400 ? 46 : 30));
  if (model.discount) push(`Discount: ${model.discount}`);
  if (model.tax) push(`Tax: ${model.tax}`);
  push(`Total: ${model.total}`, { bold: true });
  push(`Paid: ${model.paid}`);
  if (model.balance) push(`Balance on account: ${model.balance}`);
  if (model.change) push(`Change: ${model.change}`);
  push('Thank you', { center: true });

  const canvas = document.createElement('canvas');
  canvas.width = dots;
  const ctx = canvas.getContext('2d');
  // Measure first, then size the canvas to fit.
  const wrapped = [];
  for (const line of lines) {
    const size = line.size ?? 24;
    ctx.font = `${line.bold ? 'bold ' : ''}${size * scale}px ${font}`;
    const words = line.text.split(' ');
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > dots - pad * 2 && current) {
        wrapped.push({ ...line, text: current, size, bold: line.bold });
        current = word;
      } else {
        current = test;
      }
    }
    wrapped.push({ ...line, text: current, size, bold: line.bold });
  }
  canvas.height = wrapped.length * lineHeight + pad * 2;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  g.direction = 'ltr';
  wrapped.forEach((line, i) => {
    g.font = `${line.bold ? 'bold ' : ''}${(line.size ?? 24) * scale}px ${font}`;
    g.textBaseline = 'top';
    const width = g.measureText(line.text).width;
    const x = line.center ? (dots - width) / 2 : pad;
    g.fillText(line.text, x, pad + i * lineHeight);
  });
  return canvas;
}

/** ESC/POS raster image (GS v 0) of a canvas: 1 bit per dot, 1 = black. */
export function canvasToRaster(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const bytesPerRow = Math.ceil(width / 8);
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const out = new Uint8Array(8 + bytesPerRow * height);
  out.set([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff], 0);
  let p = 8;
  for (let y = 0; y < height; y += 1) {
    for (let bx = 0; bx < bytesPerRow; bx += 1) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const x = bx * 8 + bit;
        const dark = x < width && data[(y * width + x) * 4] < 128;
        if (dark) byte |= 0x80 >> bit;
      }
      out[p] = byte;
      p += 1;
    }
  }
  return out;
}

/** Prints the receipt on the connected Bluetooth printer. */
export async function printToBluetooth(model) {
  const canvas = await renderReceiptCanvas(model);
  const init = [0x1b, 0x40];
  const feed = [0x0a, 0x0a, 0x0a];
  const cut = [0x1d, 0x56, 0x42, 0x00];
  await send(new Uint8Array([...init, ...canvasToRaster(canvas), ...feed, ...cut]));
}
