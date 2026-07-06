import { Injectable } from '@angular/core';
import type jsPDF from 'jspdf';
import {
  buildRoteiroOficina,
  exibirAlertaSegurancaCdp,
  podeDirigirLabelPdf,
  urgenciaLabelHuman,
  veiculoResumoTexto
} from '@constants/cdp-display';
import { rotulosZona } from '@data/sintomas.catalog';
import { DiagnosticoCdp, HipoteseDiagnostica } from '@models/cdp.model';
import { TriageSnapshot } from '@models/triage.model';
import { normalizarTextoPdf } from '@utils/pt-br-text.util';

/** Cores pit-lane para impressão (RGB). */
const C = {
  bg: [7, 11, 20] as [number, number, number],
  surface: [248, 250, 252] as [number, number, number],
  ink: [15, 23, 42] as [number, number, number],
  mute: [100, 116, 139] as [number, number, number],
  signal: [251, 146, 60] as [number, number, number],
  safe: [34, 197, 94] as [number, number, number],
  warn: [234, 179, 8] as [number, number, number],
  danger: [220, 38, 38] as [number, number, number],
  white: [255, 255, 255] as [number, number, number]
};

const URGENCIA_RGB: Record<string, [number, number, number]> = {
  baixa: C.safe,
  media: C.warn,
  alta: C.signal,
  critica: C.danger
};

type FontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic';

@Injectable({ providedIn: 'root' })
export class CdpPdfService {
  private readonly margin = 16;
  private readonly topY = 22;
  private readonly footerZone = 22;

  async generate(snapshot: TriageSnapshot, diagnostico: DiagnosticoCdp): Promise<jsPDF> {
    const { default: JsPDF } = await import('jspdf');
    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    this.paint(doc, snapshot, diagnostico);
    return doc;
  }

  private paint(doc: jsPDF, snapshot: TriageSnapshot, d: DiagnosticoCdp): void {
    const pageW = this.pageWidth(doc);
    const contentW = pageW - this.margin * 2;
    let y = this.paintBrandHeader(doc, pageW);

    y = this.paintTitleBlock(doc, y, contentW);
    y = this.paintVehicleCard(doc, y, contentW, snapshot);
    y = this.paintSummaryHero(doc, y, contentW, d.resumo_para_cliente);
    y = this.paintStatusRow(doc, y, contentW, d);
    if (exibirAlertaSegurancaCdp(d)) {
      y = this.paintAlertBox(doc, y, contentW, d.risco_principal, d.observacoes_seguranca);
    }
    y = this.paintCausesSection(doc, y, contentW, d.hipoteses.slice(0, 3));
    y = this.paintOfficeSection(doc, y, contentW, buildRoteiroOficina(snapshot, d));
    if (d.acoes_imediatas.length > 0) {
      y = this.paintBulletSection(doc, y, contentW, 'Enquanto isso', d.acoes_imediatas);
    }

    y = this.paintSectionDivider(doc, y, contentW, 'Detalhes técnicos - oficina');
    y = this.paintTechnicalHypotheses(doc, y, contentW, d.hipoteses);

    if (d.diagnosticos_descartados?.length) {
      y = this.paintBulletSection(
        doc,
        y,
        contentW,
        'Diagnósticos descartados',
        d.diagnosticos_descartados.map((x) => `${x.titulo} - ${x.motivo_descarte}`)
      );
    }
    if (d.manutencao_preventiva_relacionada?.length) {
      y = this.paintBulletSection(
        doc,
        y,
        contentW,
        'Manutenção preventiva sugerida',
        d.manutencao_preventiva_relacionada
      );
    }
    if (d.proxima_inspecao_recomendada) {
      y = this.writeSection(doc, 'Próxima inspeção recomendada', d.proxima_inspecao_recomendada, y, contentW);
    }

    this.paintSymptomsFooter(doc, y, contentW, snapshot);
    this.paintFooters(doc, pageW, contentW);
  }

  private paintBrandHeader(doc: jsPDF, pageW: number): number {
    doc.setFillColor(...C.bg);
    doc.rect(0, 0, pageW, 12, 'F');
    doc.setFillColor(...C.signal);
    doc.rect(0, 12, pageW, 0.8, 'F');

    this.setFont(doc, 'bold', 11);
    doc.setTextColor(...C.signal);
    doc.text('PITSTOP TRIAGE', this.margin, 8);

    this.setFont(doc, 'normal', 8);
    doc.setTextColor(...C.white);
    doc.text(this.pdfText('Diagnóstico Prévio do Veículo'), pageW - this.margin, 8, { align: 'right' });

    return 20;
  }

  private paintTitleBlock(doc: jsPDF, y: number, _contentW: number): number {
    this.setFont(doc, 'bold', 16);
    doc.setTextColor(...C.ink);
    doc.text('Resumo para levar na oficina', this.margin, y);
    y += this.lineHeight(16) + 2;

    this.setFont(doc, 'normal', 9);
    doc.setTextColor(...C.mute);
    doc.text(`Emitido em ${new Date().toLocaleString('pt-BR')}`, this.margin, y);
    return y + this.lineHeight(9) + 4;
  }

  private paintVehicleCard(doc: jsPDF, y: number, contentW: number, snapshot: TriageSnapshot): number {
    const padX = 4;
    const innerW = contentW - padX * 2;
    const zona = rotulosZona[snapshot.zonaSelecionada] ?? snapshot.zonaSelecionada;
    const meta = this.pdfText(`Área: ${zona} - ${snapshot.sintomas.length} sintoma(s) relatado(s)`);

    const labelLines = this.wrapText(doc, 'VEÍCULO', innerW, 'bold', 8);
    const nameLines = this.wrapText(doc, veiculoResumoTexto(snapshot), innerW, 'bold', 11);
    const metaLines = this.wrapText(doc, meta, innerW, 'normal', 9);

    const h =
      4 +
      labelLines.length * this.lineHeight(8) +
      nameLines.length * this.lineHeight(11) +
      metaLines.length * this.lineHeight(9) +
      4;

    y = this.ensureSpace(doc, y, h);
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(...C.surface);
    doc.roundedRect(this.margin, y, contentW, h, 2, 2, 'FD');

    let ty = y + 5;
    this.setFont(doc, 'bold', 8);
    doc.setTextColor(...C.mute);
    ty = this.drawLines(doc, labelLines, this.margin + padX, ty, 8);

    this.setFont(doc, 'bold', 11);
    doc.setTextColor(...C.ink);
    ty = this.drawLines(doc, nameLines, this.margin + padX, ty, 11, 0.3);

    this.setFont(doc, 'normal', 9);
    doc.setTextColor(...C.mute);
    this.drawLines(doc, metaLines, this.margin + padX, ty, 9, 0.3);

    return y + h + 6;
  }

  private paintSummaryHero(doc: jsPDF, y: number, contentW: number, resumo: string): number {
    const pad = 4;
    const textX = this.margin + pad + 2;
    const textW = contentW - pad * 2 - 3;
    const labelH = this.lineHeight(8) + 2;
    const safeResumo = this.pdfText(resumo);

    let fontSize = 11;
    let bodyLines = this.wrapText(doc, safeResumo, textW, 'normal', fontSize);
    while (bodyLines.length > 14 && fontSize > 9) {
      fontSize -= 0.5;
      bodyLines = this.wrapText(doc, safeResumo, textW, 'normal', fontSize);
    }

    const lineGap = 0.25;
    const bodyH = bodyLines.length * (this.lineHeight(fontSize) + lineGap);
    const boxH = pad * 2 + labelH + bodyH + 2;

    y = this.ensureSpace(doc, y, boxH + 6);
    doc.setFillColor(255, 247, 237);
    doc.setDrawColor(...C.signal);
    doc.roundedRect(this.margin, y, contentW, boxH, 2, 2, 'FD');
    doc.setFillColor(...C.signal);
    doc.rect(this.margin, y, 2.5, boxH, 'F');

    this.setFont(doc, 'bold', 8);
    doc.setTextColor(...C.signal);
    doc.text('EM POUCAS PALAVRAS', textX, y + pad + 1);

    this.setFont(doc, 'normal', fontSize);
    doc.setTextColor(...C.ink);
    let ty = y + pad + labelH + 1;
    const lh = this.lineHeight(fontSize);
    for (const line of bodyLines) {
      doc.text(line, textX, ty);
      ty += lh + lineGap;
    }

    return y + boxH + 6;
  }

  private paintStatusRow(doc: jsPDF, y: number, contentW: number, d: DiagnosticoCdp): number {
    const gap = 3;
    const half = (contentW - gap) / 2;
    const innerW = half - 6;
    const lh = this.lineHeight(7.5);

    this.setFont(doc, 'bold', 7.5);
    const urgLines = this.wrapText(doc, urgenciaLabelHuman(d.urgencia_geral), innerW);
    const podeLines = this.wrapText(doc, podeDirigirLabelPdf(d.pode_dirigir), innerW);
    const lineCount = Math.max(urgLines.length, podeLines.length, 1);
    const h = lineCount * lh + 6;

    y = this.ensureSpace(doc, y, h + 4);

    const urgRgb = URGENCIA_RGB[d.urgencia_geral] ?? C.mute;
    doc.setFillColor(...urgRgb);
    doc.roundedRect(this.margin, y, half, h, 2, 2, 'F');
    doc.setTextColor(...C.white);
    this.setFont(doc, 'bold', 7.5);
    urgLines.forEach((line, i) => {
      doc.text(line, this.margin + half / 2, y + 4 + i * lh, { align: 'center' });
    });

    doc.setFillColor(...C.ink);
    doc.roundedRect(this.margin + half + gap, y, half, h, 2, 2, 'F');
    podeLines.forEach((line, i) => {
      doc.text(line, this.margin + half + gap + half / 2, y + 4 + i * lh, { align: 'center' });
    });

    return y + h + 8;
  }

  private paintAlertBox(doc: jsPDF, y: number, contentW: number, risco: string, obs: string): number {
    const padX = 4;
    const textW = contentW - padX * 2;
    const labelH = this.lineHeight(8) + 3;
    const safeRisco = this.pdfText(risco);
    const safeObs = obs.trim() ? this.pdfText(obs) : '';

    this.setFont(doc, 'normal', 9.5);
    const riscoLines = this.wrapText(doc, safeRisco, textW, 'normal', 9.5);
    const obsLines = safeObs ? this.wrapText(doc, safeObs, textW, 'normal', 9.5) : [];
    const lineGap = 0.2;
    const bodyH =
      riscoLines.length * (this.lineHeight(9.5) + lineGap) +
      (obsLines.length ? obsLines.length * (this.lineHeight(9.5) + lineGap) + 1 : 0);
    const boxH = 4 + labelH + bodyH + 3;

    y = this.ensureSpace(doc, y, boxH + 4);
    doc.setFillColor(254, 252, 232);
    doc.setDrawColor(...C.warn);
    doc.roundedRect(this.margin, y, contentW, boxH, 2, 2, 'FD');

    this.setFont(doc, 'bold', 8);
    doc.setTextColor(161, 98, 7);
    doc.text(this.pdfText('ATENÇÃO - SEGURANÇA'), this.margin + padX, y + 5);

    this.setFont(doc, 'normal', 9.5);
    doc.setTextColor(...C.ink);
    let ty = y + 5 + labelH;
    const lh = this.lineHeight(9.5);
    for (const line of riscoLines) {
      doc.text(line, this.margin + padX, ty);
      ty += lh + lineGap;
    }
    if (obsLines.length) {
      ty += 1;
      for (const line of obsLines) {
        doc.text(line, this.margin + padX, ty);
        ty += lh + lineGap;
      }
    }

    return y + boxH + 6;
  }

  private paintCausesSection(
    doc: jsPDF,
    y: number,
    contentW: number,
    hipoteses: HipoteseDiagnostica[]
  ): number {
    if (hipoteses.length === 0) return y;

    y = this.paintSectionHeading(doc, y, 'Possíveis causas');
    this.setFont(doc, 'normal', 8);
    doc.setTextColor(...C.mute);
    y = this.drawWrapped(
      doc,
      'Hipóteses mais prováveis - a oficina confirmará com inspeção.',
      this.margin,
      y,
      contentW,
      8,
      'normal'
    );
    y += 2;

    const padX = 4;
    const innerW = contentW - padX * 2;

    hipoteses.forEach((h, index) => {
      const titleLines = this.wrapText(doc, `${index + 1}. ${h.titulo}`, innerW, 'bold', 10);
      const justLines = this.wrapText(doc, h.justificativa_tecnica, innerW, 'normal', 9);
      const cost = this.pdfText(`Estimativa: R$ ${h.custo_estimado_brl.min} - ${h.custo_estimado_brl.max}`);

      const titleH = titleLines.length * this.lineHeight(10);
      const justH = justLines.length * this.lineHeight(9);
      const costH = this.lineHeight(8) + 2;
      const boxH = 5 + titleH + 1 + justH + 2 + costH + 2;

      y = this.ensureSpace(doc, y, boxH);
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(...C.surface);
      doc.roundedRect(this.margin, y, contentW, boxH, 1.5, 1.5, 'FD');

      let ty = y + 5;
      this.setFont(doc, 'bold', 10);
      doc.setTextColor(...C.ink);
      ty = this.drawLines(doc, titleLines, this.margin + padX, ty, 10, 0.2);

      this.setFont(doc, 'normal', 9);
      doc.setTextColor(...C.mute);
      this.drawLines(doc, justLines, this.margin + padX, ty + 1, 9, 0.2);

      this.setFont(doc, 'bold', 8);
      doc.setTextColor(...C.signal);
      doc.text(cost, this.margin + padX, y + boxH - 3);

      y += boxH + 3;
    });

    return y + 3;
  }

  private paintOfficeSection(doc: jsPDF, y: number, contentW: number, linhas: string[]): number {
    y = this.paintSectionHeading(doc, y, 'Leve isso na oficina');
    this.setFont(doc, 'normal', 8);
    doc.setTextColor(...C.mute);
    y = this.drawWrapped(
      doc,
      'Mostre este resumo na recepção para agilizar o atendimento.',
      this.margin,
      y,
      contentW,
      8,
      'normal'
    );
    y += 2;

    linhas.forEach((linha) => {
      y = this.drawWrapped(doc, `- ${linha}`, this.margin + 2, y, contentW - 4, 9.5, 'normal', 0.3);
    });

    return y + 4;
  }

  private paintSectionDivider(doc: jsPDF, y: number, contentW: number, label: string): number {
    y = this.ensureSpace(doc, y, 16);
    if (y > this.topY + 5) {
      doc.addPage();
      y = this.topY;
    }

    doc.setDrawColor(...C.signal);
    doc.setLineWidth(0.4);
    doc.line(this.margin, y, this.margin + contentW, y);
    y += 5;

    this.setFont(doc, 'bold', 10);
    doc.setTextColor(...C.signal);
    doc.text(this.pdfText(label.toUpperCase()), this.margin, y);
    return y + this.lineHeight(10) + 4;
  }

  private paintTechnicalHypotheses(
    doc: jsPDF,
    y: number,
    contentW: number,
    hipoteses: HipoteseDiagnostica[]
  ): number {
    hipoteses.forEach((h, index) => {
      y = this.ensureSpace(doc, y, this.lineHeight(10) + 2);
      this.setFont(doc, 'bold', 10);
      doc.setTextColor(...C.ink);
      y = this.drawWrapped(doc, `${index + 1}. ${h.titulo}`, this.margin, y, contentW, 10, 'bold');

      this.setFont(doc, 'normal', 8);
      doc.setTextColor(...C.mute);
      y = this.drawWrapped(
        doc,
        `${h.probabilidade}% - conf. ${h.confianca} - ${h.sistema_afetado}`,
        this.margin,
        y,
        contentW,
        8,
        'normal',
        0.2
      );

      this.setFont(doc, 'normal', 9);
      doc.setTextColor(...C.ink);
      y = this.drawWrapped(
        doc,
        `Custo R$ ${h.custo_estimado_brl.min}-${h.custo_estimado_brl.max} - Tempo ${h.tempo_reparo_horas.min}-${h.tempo_reparo_horas.max}h`,
        this.margin,
        y,
        contentW,
        9,
        'normal',
        0.2
      );

      if (h.componentes_a_verificar.length > 0) {
        this.setFont(doc, 'bold', 8);
        doc.setTextColor(...C.signal);
        y = this.drawWrapped(doc, 'Verificar:', this.margin, y, contentW, 8, 'bold', 0.2);
        h.componentes_a_verificar.forEach((c) => {
          y = this.drawWrapped(
            doc,
            `[${c.prioridade}] ${c.nome} - ${c.teste_recomendado}`,
            this.margin + 2,
            y,
            contentW - 2,
            8,
            'normal',
            0.2
          );
        });
      }

      if (h.codigos_obd_possiveis?.length) {
        this.setFont(doc, 'normal', 8);
        doc.setTextColor(...C.mute);
        y = this.drawWrapped(
          doc,
          `OBD: ${h.codigos_obd_possiveis.join(', ')}`,
          this.margin,
          y,
          contentW,
          8,
          'normal',
          0.2
        );
      }

      y += 4;
    });
    return y;
  }

  private paintSymptomsFooter(doc: jsPDF, y: number, contentW: number, snapshot: TriageSnapshot): number {
    const sintomas = snapshot.sintomas.join(', ') || '-';
    return this.writeSection(doc, 'Sintomas informados pelo cliente', sintomas, y, contentW);
  }

  private paintSectionHeading(doc: jsPDF, y: number, title: string): number {
    y = this.ensureSpace(doc, y, this.lineHeight(11) + 4);
    this.setFont(doc, 'bold', 11);
    doc.setTextColor(...C.ink);
    doc.text(this.pdfText(title), this.margin, y);
    return y + this.lineHeight(11) + 3;
  }

  private paintBulletSection(
    doc: jsPDF,
    y: number,
    contentW: number,
    title: string,
    items: string[]
  ): number {
    y = this.paintSectionHeading(doc, y, title);
    this.setFont(doc, 'normal', 9.5);
    doc.setTextColor(...C.ink);
    items.forEach((item) => {
      y = this.drawWrapped(doc, `- ${item}`, this.margin, y, contentW, 9.5, 'normal', 0.3);
    });
    return y + 2;
  }

  private writeSection(doc: jsPDF, title: string, body: string, y: number, contentW: number): number {
    y = this.paintSectionHeading(doc, y, title);
    this.setFont(doc, 'normal', 9.5);
    doc.setTextColor(...C.ink);
    y = this.drawWrapped(doc, body, this.margin, y, contentW, 9.5, 'normal', 0.3);
    return y + 3;
  }

  private paintFooters(doc: jsPDF, pageW: number, contentW: number): void {
    const totalPages = doc.getNumberOfPages();
    const footerY = this.pageHeight(doc) - 8;
    const disclaimer = this.pdfText(
      'Diagnóstico prévio assistido por IA - não substitui inspeção presencial qualificada.'
    );

    for (let page = 1; page <= totalPages; page++) {
      doc.setPage(page);
      doc.setDrawColor(226, 232, 240);
      doc.line(this.margin, footerY - 4, pageW - this.margin, footerY - 4);

      this.setFont(doc, 'italic', 7.5);
      doc.setTextColor(...C.mute);
      const disclaimerW = contentW - 28;
      const lines = this.wrapText(doc, disclaimer, disclaimerW);
      const lh = this.lineHeight(7.5);
      let ty = footerY - (lines.length - 1) * lh;
      lines.forEach((line) => {
        doc.text(line, this.margin, ty);
        ty += lh;
      });

      this.setFont(doc, 'normal', 7.5);
      doc.text(`Pág. ${page}/${totalPages}`, pageW - this.margin, footerY, { align: 'right' });
    }
  }

  private setFont(doc: jsPDF, style: FontStyle, size: number): void {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
  }

  /** Espacamento vertical proporcional ao tamanho da fonte (mm). */
  private lineHeight(fontSize: number): number {
    return fontSize * 0.42 + 0.8;
  }

  private wrapText(
    doc: jsPDF,
    text: string,
    maxWidth: number,
    style: FontStyle = 'normal',
    size = 9
  ): string[] {
    const safe = this.pdfText(text);
    if (!safe) return [];
    this.setFont(doc, style, size);
    return doc.splitTextToSize(safe, maxWidth) as string[];
  }

  private drawLines(doc: jsPDF, lines: string[], x: number, y: number, fontSize: number, gap = 0): number {
    const lh = this.lineHeight(fontSize);
    for (const line of lines) {
      y = this.ensureSpace(doc, y, lh + gap);
      doc.text(line, x, y);
      y += lh + gap;
    }
    return y;
  }

  private drawWrapped(
    doc: jsPDF,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    fontSize: number,
    style: FontStyle = 'normal',
    gap = 0.2
  ): number {
    this.setFont(doc, style, fontSize);
    const lines = this.wrapText(doc, text, maxWidth, style, fontSize);
    return this.drawLines(doc, lines, x, y, fontSize, gap);
  }

  private pageWidth(doc: jsPDF): number {
    return doc.internal.pageSize.getWidth();
  }

  private pageHeight(doc: jsPDF): number {
    return doc.internal.pageSize.getHeight();
  }

  private bottomLimit(doc: jsPDF): number {
    return this.pageHeight(doc) - this.footerZone;
  }

  private ensureSpace(doc: jsPDF, y: number, needed: number): number {
    if (y + needed > this.bottomLimit(doc)) {
      doc.addPage();
      return this.topY;
    }
    return y;
  }

  private pdfText(text: string): string {
    return normalizarTextoPdf(text);
  }
}
