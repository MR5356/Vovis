import { expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// A self-contained PDF regression fixture: transparent red above a blue form
// whose luminosity soft mask is black (invisible), grey (half), then white.
function transparencyPdf() {
  const stream = (content: string, dictionary = "") =>
    `<< ${dictionary} /Length ${content.length} >>\nstream\n${content}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 90 60] /Resources << /ExtGState << /Fade 5 0 R /Mask 6 0 R >> >> /Contents 4 0 R >>",
    stream(
      "q /Fade gs 1 0 0 rg 0 0 90 60 re f Q q /Mask gs 0 0 1 rg 0 0 90 30 re f Q",
    ),
    "<< /Type /ExtGState /ca 0.5 >>",
    "<< /Type /ExtGState /SMask << /S /Luminosity /G 7 0 R >> >>",
    stream(
      "0 g 0 0 30 30 re f 0.5 g 30 0 30 30 re f 1 g 60 0 30 30 re f",
      "/Type /XObject /Subtype /Form /BBox [0 0 90 30] /Resources << >> /Group << /S /Transparency /CS /DeviceRGB >>",
    ),
  ];
  let source = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(source.length);
    source += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = source.length;
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    source += `${String(offset).padStart(10, "0")} 00000 n \n`;
  source += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(source);
}

it("composites opacity and luminosity masks over the PDF page instead of painting black", async () => {
  const loading = getDocument({
    data: transparencyPdf(),
    disableWorkerRendering: true,
  });
  try {
    const pdf = await loading.promise;
    const page = await pdf.getPage(1);
    const canvas = createCanvas(90, 60);
    const context = canvas.getContext("2d");
    await page.render({
      canvas: null,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport: page.getViewport({ scale: 1 }),
      background: "#ffffff",
    }).promise;
    const pixel = (x: number, y: number) =>
      Array.from(context.getImageData(x, y, 1, 1).data);
    const closeTo = (actual: number[], expected: number[]) => {
      actual.forEach((value, index) =>
        expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(2),
      );
    };
    closeTo(pixel(15, 15), [255, 127, 127, 255]);
    closeTo(pixel(15, 45), [255, 127, 127, 255]);
    closeTo(pixel(45, 45), [127, 63, 191, 255]);
    closeTo(pixel(75, 45), [0, 0, 255, 255]);
  } finally {
    await loading.destroy();
  }
});
