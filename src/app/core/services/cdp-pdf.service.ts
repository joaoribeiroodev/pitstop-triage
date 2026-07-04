import { Injectable } from '@angular/core';
import type jsPDF from 'jspdf';
import {
  buildRoteiroOficina,
  exibirAlertaSegurancaCdp,
  podeDirigirLabelPdf,
  urgenciaLabelHuman,
  veiculoResumoTexto
} from '@core/constants/cdp-display';
import { rotulosZona } from '@core/data/sintomas.catalog';
import { DiagnosticoCdp, HipoteseDiagnostica } from '@core/models/cdp.model';
import { TriageSnapshot } from '@core/models/triage.model';
import { normalizarTextoPdf } from '@core/utils/pt-br-text.util';

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

@Injectable({ providedIn: 'root' })
export class CdpPdfService {
  private readonly margin = 16;
  private readonly topY = 22;
  private readonly lineH = 4.8;
  private readonly footerZone = 20;

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
      y = this.paintBulletSection(doc, y, contentW, 'Manutenção preventiva sugerida', d.manutencao_preventiva_relacionada);
    }
    if (d.proxima_inspecao_recomendada) {
      y = this.writeSection(doc, 'Próxima inspeção recomendada', d.proxima_inspecao_recomendada, y, contentW);
    }

    y = this.paintSymptomsFooter(doc, y, contentW, snapshot);
    this.paintFooters(doc, pageW);
  }

  private paintBrandHeader(doc: jsPDF, pageW: number): number {
    doc.setFillColor(...C.bg);
    doc.rect(0, 0, pageW, 12, 'F');
    doc.setFillColor(...C.signal);
    doc.rect(0, 12, pageW, 0.8, 'F');

    doc.setTextColor(...C.signal);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('PITSTOP TRIAGE', this.margin, 8);

    doc.setTextColor(...C.white);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(this.pdfText('Diagnóstico Prévio do Veículo'), pageW - this.margin, 8, { align: 'right' });

    return 20;
  }

  private paintTitleBlock(doc: jsPDF, y: number, contentW: number): number {
    doc.setTextColor(...C.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Resumo para levar na oficina', this.margin, y);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.mute);
    doc.text(`Emitido em ${new Date().toLocaleString('pt-BR')}`, this.margin, y);
    return y + 8;
  }

  private paintVehicleCard(doc: jsPDF, y: number, contentW: number, snapshot: TriageSnapshot): number {
    const h = 22;
    y = this.ensureSpace(doc, y, h);
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(...C.surface);
    doc.roundedRect(this.margin, y, contentW, h, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...C.mute);
    doc.text(this.pdfText('VEÍCULO'), this.margin + 4, y + 5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...C.ink);
    doc.text(this.pdfText(veiculoResumoTexto(snapshot)), this.margin + 4, y + 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.mute);
    const zona = rotulosZona[snapshot.zonaSelecionada] ?? snapshot.zonaSelecionada;
    doc.text(this.pdfText(`Área: ${zona}  ·  ${snapshot.sintomas.length} sintoma(s) relatado(s)`), this.margin + 4, y + 17);

    return y + h + 6;
  }

  private paintSummaryHero(doc: jsPDF, y: number, contentW: number, resumo: string): number {
    const pad = 4;
    const textW = contentW - pad * 2 - 3;
    const texto = this.pdfText(resumo);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(texto, textW) as string[];
    const boxH = lines.length * this.lineH + pad * 2 + 8;

    y = this.ensureSpace(doc, y, boxH + 4);
    doc.setFillColor(255, 247, 237);
    doc.setDrawColor(...C.signal);
    doc.roundedRect(this.margin, y, contentW, boxH, 2, 2, 'FD');
    doc.setFillColor(...C.signal);
    doc.rect(this.margin, y, 2.5, boxH, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...C.signal);
    doc.text('EM POUCAS PALAVRAS', this.margin + pad + 2, y + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...C.ink);
    let ty = y + 10;
    lines.forEach((line) => {
      doc.text(line, this.margin + pad + 2, ty);
      ty += this.lineH;
    });

    return y + boxH + 6;
  }

  private paintStatusRow(doc: jsPDF, y: number, contentW: number, d: DiagnosticoCdp): number {
    const half = (contentW - 3) / 2;
    const urgLabel = this.pdfText(urgenciaLabelHuman(d.urgencia_geral));
    const podeLabel = this.pdfText(podeDirigirLabelPdf(d.pode_dirigir));

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const urgLines = doc.splitTextToSize(urgLabel, half - 6) as string[];
    const podeLines = doc.splitTextToSize(podeLabel, half - 6) as string[];
    const h = Math.max(urgLines.length, podeLines.length) * this.lineH + 4;

    y = this.ensureSpace(doc, y, h + 4);

    const urgRgb = URGENCIA_RGB[d.urgencia_geral] ?? C.mute;
    doc.setFillColor(...urgRgb);
    doc.roundedRect(this.margin, y, half, h, 2, 2, 'F');
    doc.setTextColor(...C.white);
    doc.setFontSize(7.5);
    urgLines.forEach((line, i) => {
      doc.text(line, this.margin + half / 2, y + 4 + i * this.lineH, { align: 'center' });
    });

    doc.setFillColor(...C.ink);
    doc.roundedRect(this.margin + half + 3, y, half, h, 2, 2, 'F');
    podeLines.forEach((line, i) => {
      doc.text(line, this.margin + half + 3 + half / 2, y + 4 + i * this.lineH, { align: 'center' });
    });

    return y + h + 8;
  }

  private paintAlertBox(doc: jsPDF, y: number, contentW: number, risco: string, obs: string): number {
    const body = `${risco}\n${obs}`;
    const lines = doc.splitTextToSize(this.pdfText(body), contentW - 8) as string[];
    const boxH = lines.length * this.lineH + 10;

    y = this.ensureSpace(doc, y, boxH);
    doc.setFillColor(254, 252, 232);
    doc.setDrawColor(...C.warn);
    doc.roundedRect(this.margin, y, contentW, boxH, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(161, 98, 7);
    doc.text(this.pdfText('ATENÇÃO - SEGURANÇA'), this.margin + 4, y + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...C.ink);
    let ty = y + 10;
    lines.forEach((line) => {
      doc.text(line, this.margin + 4, ty);
      ty += this.lineH;
    });

    return y + boxH + 6;
  }

  private paintCausesSection(doc: jsPDF, y: number, contentW: number, hipoteses: HipoteseDiagnostica[]): number {
    if (hipoteses.length === 0) return y;

    y = this.paintSectionHeading(doc, y, 'Possíveis causas');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.mute);
    y = this.ensureSpace(doc, y, this.lineH);
    doc.text('Hipóteses mais prováveis - a oficina confirmará com inspeção.', this.margin, y);
    y += 6;

    hipoteses.forEach((h, index) => {
      const title = `${index + 1}. ${h.titulo}`;
      const cost = `Estimativa: R$ ${h.custo_estimado_brl.min} - ${h.custo_estimado_brl.max}`;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      const titleLines = doc.splitTextToSize(this.pdfText(title), contentW - 8) as string[];
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const justLines = doc.splitTextToSize(this.pdfText(h.justificativa_tecnica), contentW - 8) as string[];
      const boxH = titleLines.length * this.lineH + justLines.length * this.lineH + 18;

      y = this.ensureSpace(doc, y, boxH);
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(...C.surface);
      doc.roundedRect(this.margin, y, contentW, boxH, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...C.ink);
      let ty = y + 5;
      titleLines.forEach((line) => {
        doc.text(line, this.margin + 4, ty);
        ty += this.lineH;
      });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...C.mute);
      ty += 1;
      justLines.forEach((line) => {
        doc.text(line, this.margin + 4, ty);
        ty += this.lineH;
      });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...C.signal);
      doc.text(this.pdfText(cost), this.margin + 4, y + boxH - 3);

      y += boxH + 3;
    });

    return y + 3;
  }

  private paintOfficeSection(doc: jsPDF, y: number, contentW: number, linhas: string[]): number {
    y = this.paintSectionHeading(doc, y, 'Leve isso na oficina');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.mute);
    y = this.ensureSpace(doc, y, this.lineH);
    doc.text('Mostre este resumo na recepção para agilizar o atendimento.', this.margin, y);
    y += 5;

    linhas.forEach((linha) => {
      y = this.ensureSpace(doc, y, this.lineH);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...C.ink);
      doc.text(`> ${this.pdfText(linha)}`, this.margin + 2, y);
      y += this.lineH + 1;
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

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.signal);
    doc.text(this.pdfText(label.toUpperCase()), this.margin, y);
    return y + 8;
  }

  private paintTechnicalHypotheses(doc: jsPDF, y: number, contentW: number, hipoteses: HipoteseDiagnostica[]): number {
    hipoteses.forEach((h, index) => {
      y = this.ensureSpace(doc, y, 14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...C.ink);
      y = this.writeWrapped(doc, `${index + 1}. ${h.titulo}`, this.margin, y, contentW);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...C.mute);
      y = this.writeWrapped(
        doc,
        `${h.probabilidade}% · conf. ${h.confianca} · ${h.sistema_afetado}`,
        this.margin,
        y,
        contentW
      );
      y += 1;

      doc.setFontSize(9);
      y = this.writeWrapped(
        doc,
        `Custo R$ ${h.custo_estimado_brl.min}-${h.custo_estimado_brl.max} · Tempo ${h.tempo_reparo_horas.min}-${h.tempo_reparo_horas.max}h`,
        this.margin,
        y,
        contentW
      );

      if (h.componentes_a_verificar.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...C.signal);
        y = this.writeWrapped(doc, 'Verificar:', this.margin, y, contentW);
        h.componentes_a_verificar.forEach((c) => {
          y = this.writeWrapped(
            doc,
            `  [${c.prioridade}] ${c.nome} — ${c.teste_recomendado}`,
            this.margin,
            y,
            contentW
          );
        });
      }

      if (h.codigos_obd_possiveis?.length) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...C.mute);
        y = this.writeWrapped(doc, `OBD: ${h.codigos_obd_possiveis.join(', ')}`, this.margin, y, contentW);
      }

      y += 4;
    });
    return y;
  }

  private paintSymptomsFooter(doc: jsPDF, y: number, contentW: number, snapshot: TriageSnapshot): number {
    const sintomas = snapshot.sintomas.join(', ') || '—';
    return this.writeSection(doc, 'Sintomas informados pelo cliente', sintomas, y, contentW);
  }

  private paintSectionHeading(doc: jsPDF, y: number, title: string): number {
    y = this.ensureSpace(doc, y, 10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...C.ink);
    doc.text(title, this.margin, y);
    return y + 6;
  }

  private paintBulletSection(doc: jsPDF, y: number, contentW: number, title: string, items: string[]): number {
    y = this.paintSectionHeading(doc, y, title);
    items.forEach((item) => {
      y = this.writeWrapped(doc, `· ${item}`, this.margin, y, contentW);
      y += 1;
    });
    return y + 2;
  }

  private writeSection(doc: jsPDF, title: string, body: string, y: number, contentW: number): number {
    y = this.paintSectionHeading(doc, y, title);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...C.ink);
    y = this.writeWrapped(doc, body, this.margin, y, contentW);
    return y + 3;
  }

  private paintFooters(doc: jsPDF, pageW: number): void {
    const totalPages = doc.getNumberOfPages();
    const footerY = this.pageHeight(doc) - 8;
    for (let page = 1; page <= totalPages; page++) {
      doc.setPage(page);
      doc.setDrawColor(226, 232, 240);
      doc.line(this.margin, footerY - 4, pageW - this.margin, footerY - 4);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.mute);
      doc.text(
        this.pdfText('Diagnóstico prévio assistido por IA - não substitui inspeção presencial qualificada.'),
        this.margin,
        footerY
      );
      doc.text(`Pág. ${page}/${totalPages}`, pageW - this.margin, footerY, { align: 'right' });
    }
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

  private writeWrapped(doc: jsPDF, text: string, x: number, y: number, maxWidth: number): number {
    const safeText = this.pdfText(text);
    const lines = doc.splitTextToSize(safeText, maxWidth) as string[];
    for (const line of lines) {
      y = this.ensureSpace(doc, y, this.lineH);
      doc.text(line, x, y);
      y += this.lineH;
    }
    return y;
  }

  private pdfText(text: string): string {
    return normalizarTextoPdf(text);
  }
}
