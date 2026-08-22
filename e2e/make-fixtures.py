#!/usr/bin/env python3
"""生成 E2E 用的简历样例：sample-resume.docx（手写 OOXML zip）+ sample-resume-en.pdf（手写最小 PDF）。
用法：python3 e2e/make-fixtures.py"""
import os
import zipfile

BASE = os.path.dirname(os.path.abspath(__file__))

RESUME_LINES = [
    "张三丰",
    "男 | 2001-03-15 | 汉族 | 共青团员 | 籍贯：广东省 广州市",
    "手机：13800001234 | 邮箱：zsf@example.com | GitHub：https://github.com/zsf",
    "政治面貌：共青团员 | 户口所在地：广东省 广州市 | 现居：杭州市 | 身高 178cm",
    "",
    "教育经历",
    "2018.09 - 2022.06 示例理工大学 计算机科学与技术 本科 学士 GPA 3.6/4.0 专业排名前15%",
    "主修课程：数据结构、操作系统、计算机网络",
    "2022.09 - 2026.06 示例大学 计算机学院 软件工程 硕士研究生 硕士 GPA 3.8/4.0 专业排名前10% 985",
    "",
    "实习经历",
    "2024.06 - 2024.12 示例科技有限公司 基础架构部 后端开发实习生",
    "负责内部平台的接口开发与性能优化，将核心查询耗时降低 40%。",
    "",
    "荣誉奖项",
    "2023.10 国家奖学金（国家级）",
    "",
    "语言能力",
    "英语 CET-6 580 分（2020.12）",
    "",
    "家庭成员",
    "父亲 张大山 个体经营 经营者 联系电话 13900000001",
    "母亲 李秀兰 示例小学 教师 联系电话 13900000002",
    "",
    "求职意向",
    "期望城市：杭州市、深圳市 | 期望职位：后端开发工程师 | 期望年薪 20-30 万",
    "",
    "自我评价",
    "扎实的计算机基础与后端开发经验，实习期间独立完成多个核心模块；学习能力强，抗压性好，乐于团队协作。",
]

# ---------- DOCX：最小 OOXML ----------
doc_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '<w:body>'
    + ''.join(
        f'<w:p><w:r><w:t xml:space="preserve">{line}</w:t></w:r></w:p>' for line in RESUME_LINES
    )
    + '<w:sectPr/></w:body></w:document>'
)
content_types = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>'
)
rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    '</Relationships>'
)
docx_path = os.path.join(BASE, 'sample-resume.docx')
with zipfile.ZipFile(docx_path, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', content_types)
    z.writestr('_rels/.rels', rels)
    z.writestr('word/document.xml', doc_xml)
print('written', docx_path)

# ---------- PDF：最小单页文本 PDF（ASCII，pdf.js 文本层可提取） ----------
pdf_lines = [
    "Zhang Sanfeng - Resume (test fixture)",
    "Phone: 13800001234  Email: zsf@example.com",
    "Education: Example University, M.S. Software Engineering, 2022-2026",
    "Experience: Example Tech, Backend Intern, 2024.06-2024.12",
]
content = "BT /F1 11 Tf 50 760 Td 16 TL\n" + "\n".join(f"({l.replace('(', '').replace(')', '')}) Tj T*" for l in pdf_lines) + "\nET"
objs = []
objs.append("<< /Type /Catalog /Pages 2 0 R >>")
objs.append("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
objs.append("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>")
objs.append(f"<< /Length {len(content)} >>\nstream\n{content}\nendstream")
objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

out = ["%PDF-1.4"]
offsets = []
pos = len("%PDF-1.4\n")
for i, obj in enumerate(objs, start=1):
    s = f"{i} 0 obj\n{obj}\nendobj\n"
    offsets.append(pos)
    out.append(s)
    pos += len(s)
xref_pos = pos
xref = "xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
for off in offsets:
    xref += f"{off:010d} 00000 n \n"
trailer = f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n"
pdf_path = os.path.join(BASE, 'sample-resume-en.pdf')
with open(pdf_path, 'wb') as f:
    f.write(("\n".join(out)[:8] + "\n" + "".join(out[1:])).encode())  # header 带换行
    f.write(xref.encode())
    f.write(trailer.encode())
print('written', pdf_path)
