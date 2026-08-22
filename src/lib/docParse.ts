/**
 * 文档 → 纯文本（本地解析，不上传）。
 * DOCX：mammoth（保留换行）；PDF：pdf.js 文本层；TXT：直读。
 * 扫描件/图片型 PDF 文本密度低 → 返回 lowDensity=true（提示走视觉模型，M1+ 交付）。
 */
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export interface ParsedDoc {
  text: string
  pages?: number
  lowDensity: boolean
  kind: 'pdf' | 'docx' | 'txt'
}

export async function extractTextFromFile(file: File): Promise<ParsedDoc> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.docx')) return parseDocx(await file.arrayBuffer())
  if (name.endsWith('.pdf')) return parsePdf(await file.arrayBuffer())
  if (name.endsWith('.txt') || file.type.startsWith('text/')) {
    return { text: (await file.text()).trim(), lowDensity: false, kind: 'txt' }
  }
  throw new Error('暂不支持该格式（支持 .pdf / .docx / .txt）')
}

async function parseDocx(buf: ArrayBuffer): Promise<ParsedDoc> {
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf })
  const text = value.replace(/\n{3,}/g, '\n\n').trim()
  if (!text) throw new Error('DOCX 里没有可读文本（可能内容全是图片）')
  return { text, lowDensity: false, kind: 'docx' }
}

async function parsePdf(buf: ArrayBuffer): Promise<ParsedDoc> {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true }).promise
  const parts: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    // 按 Y 坐标聚行，行内按 X 排序，尽量还原阅读顺序
    const lines = new Map<number, Array<{ x: number; s: string }>>()
    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      if (!item.str || !item.str.trim() || !item.transform) continue
      const y = Math.round(item.transform[5] / 6) // 6pt 粒度聚行
      const arr = lines.get(y) ?? []
      arr.push({ x: item.transform[4], s: item.str })
      lines.set(y, arr)
    }
    const pageText = Array.from(lines.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, arr]) => arr.sort((a, b) => a.x - b.x).map((t) => t.s).join(''))
      .join('\n')
    parts.push(pageText)
  }
  const text = parts.join('\n\n').trim()
  const density = text.length / Math.max(doc.numPages, 1)
  return { text, pages: doc.numPages, lowDensity: density < 120, kind: 'pdf' }
}

/** 粗清洗：去页码、CJK 间多余空格（PDF 提取常见"王 宏 宇"）、断行拼接（供 LLM 抽取前） */
export function cleanResumeText(text: string): string {
  return text
    .replace(/^\s*\d{1,3}\s*$/gm, '') // 独立页码行
    .replace(/\u00a0/g, ' ')
    .replace(/(?<=[\u4e00-\u9fff，。、；：（）])\s+(?=[\u4e00-\u9fff，。、；：（）])/g, '') // 汉字/中文标点之间的空格
    .replace(/(\d)\s+(\d)/g, '$1$2') // 被断开的数字（202 4.09 → 2024.09）
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
