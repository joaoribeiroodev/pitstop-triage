import { Injectable } from '@angular/core';
import type jsPDF from 'jspdf';
import { PODE_DIRIGIR_LABEL } from '@core/constants/cdp-display';
import { rotulosZona } from '@core/data/sintomas.catalog';
import { DiagnosticoCdp } from '@core/models/cdp.model';
import { TriageSnapshot } from '@core/models/triage.model';

@Injectable({ providedIn: 'root' })
export class CdpPdfService {
  private readonly margin = 14;
  private readonly topY = 20;
  private readonly lineH = 5;
  /** Área reservada para o rodapé em cada página. */
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
    let y = 20;

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 14, 'F');
    doc.setTextColor(251, 146, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('PITSTOP TRIAGE', this.margin, 9);
    doc.setTextColor(226, 232, 240);
    doc.setFontSize(9);
    doc.text('Código de Diagnóstico Prévio', pageW - this.margin, 9, { align: 'right' });

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('CDP — Diagnóstico Prévio', this.margin, (y = 26));
    y += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text(`Emitido em ${new Date().toLocaleString('pt-BR')}`, this.margin, y);
    y += 8;

    y = this.ensureSpace(doc, y, 32);
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(this.margin, y, contentW, 30, 2, 2, 'FD');
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('VEÍCULO', this.margin + 4, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(
      `${snapshot.veiculo.marca} ${snapshot.veiculo.modelo} ${snapshot.veiculo.ano}`.trim() || '-',
      this.margin + 4,
      y + 13
    );
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `FIPE: ${snapshot.veiculo.codigoFipe || (snapshot.veiculo.origem === 'manual' ? 'Manual' : '-')}    Origem: ${snapshot.veiculo.origem || '-'}`,
      this.margin + 4,
      y + 20
    );
    doc.text(
      `Zona: ${rotulosZona[snapshot.zonaSelecionada] ?? snapshot.zonaSelecionada}    Sintomas: ${snapshot.sintomas.length}`,
      this.margin + 4,
      y + 26
    );
    y += 38;

    const urgColors: Record<string, [number, number, number]> = {
      baixa: [34, 197, 94],
      media: [234, 179, 8],
      alta: [249, 115, 22],
      critica: [220, 38, 38]
    };
    const [r, g, b] = urgColors[d.urgencia_geral] ?? [100, 116, 139];
    y = this.ensureSpace(doc, y, 12);
    doc.setFillColor(r, g, b);
    doc.roundedRect(this.margin, y, 50, 9, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`URGÊNCIA ${d.urgencia_geral.toUpperCase()}`, this.margin + 25, y + 6, { align: 'center' });

    const podeLabel = PODE_DIRIGIR_LABEL[d.pode_dirigir].label.toUpperCase();
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(this.margin + 54, y, contentW - 54, 9, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(podeLabel.length > 28 ? 8 : 9);
    doc.text(podeLabel, this.margin + 54 + (contentW - 54) / 2, y + 6, { align: 'center' });
    y += 16;

    y = this.writeSection(doc, 'Risco principal', d.risco_principal, y, contentW);
    y = this.writeSection(doc, 'Resumo para o cliente', d.resumo_para_cliente, y, contentW);
    y = this.writeSection(doc, 'Observações de segurança', d.observacoes_seguranca, y, contentW);

    y = this.ensureSpace(doc, y, 10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('Ações imediatas', this.margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
    d.acoes_imediatas.forEach((acao, index) => {
      y = this.writeWrapped(doc, `${index + 1}. ${acao}`, this.margin, y, contentW);
      y += 1;
    });
    y += 3;

    y = this.ensureSpace(doc, y, 10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('Hipóteses técnicas', this.margin, y);
    y += 6;

    d.hipoteses.forEach((hipotese, index) => {
      const stats = `${hipotese.probabilidade}% | conf. ${hipotese.confianca}`;
      const title = `${index + 1}. ${hipotese.titulo}`;
      const titleLines = doc.splitTextToSize(title, contentW - 42) as string[];
      const barH = Math.max(8, titleLines.length * this.lineH + 3);

      y = this.ensureSpace(doc, y, barH + 28);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(this.margin, y, contentW, barH, 1.5, 1.5, 'F');
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      titleLines.forEach((line, lineIndex) => {
        doc.text(line, this.margin + 2, y + 4.5 + lineIndex * this.lineH);
      });
      doc.setTextColor(8, 145, 178);
      doc.setFontSize(9);
      doc.text(stats, pageW - this.margin - 2, y + 4.5, { align: 'right' });
      y += barH + 2;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      y = this.ensureSpace(doc, y, this.lineH);
      doc.text(`Sistema: ${hipotese.sistema_afetado}`, this.margin, y);
      y += this.lineH;
      y = this.ensureSpace(doc, y, this.lineH);
      doc.text(
        `Custo: R$ ${hipotese.custo_estimado_brl.min}-${hipotese.custo_estimado_brl.max}    Tempo: ${hipotese.tempo_reparo_horas.min}-${hipotese.tempo_reparo_horas.max}h`,
        this.margin,
        y
      );
      y += this.lineH;

      doc.setFontSize(10);
      doc.setTextColor(51, 65, 85);
      y = this.writeWrapped(doc, hipotese.justificativa_tecnica, this.margin, y, contentW);
      y += 2;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(8, 145, 178);
      y = this.writeWrapped(
        doc,
        `Evidências: ${hipotese.evidencias_usadas.join(' / ')}`,
        this.margin,
        y,
        contentW
      );

      const componentes = hipotese.componentes_a_verificar
        .map((c) => `${c.nome} [${c.prioridade}] - ${c.teste_recomendado}`)
        .join(' / ');
      doc.setTextColor(234, 88, 12);
      y = this.writeWrapped(doc, `Verificar: ${componentes}`, this.margin, y, contentW);

      if (hipotese.codigos_obd_possiveis && hipotese.codigos_obd_possiveis.length > 0) {
        doc.setTextColor(8, 145, 178);
        y = this.writeWrapped(
          doc,
          `OBD: ${hipotese.codigos_obd_possiveis.join(', ')}`,
          this.margin,
          y,
          contentW
        );
      }
      y += 4;
    });

    if (d.diagnosticos_descartados && d.diagnosticos_descartados.length > 0) {
      y = this.ensureSpace(doc, y, 10);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text('Diagnósticos descartados', this.margin, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      d.diagnosticos_descartados.forEach((descartado) => {
        y = this.writeWrapped(
          doc,
          `[X] ${descartado.titulo} - ${descartado.motivo_descarte}`,
          this.margin,
          y,
          contentW
        );
        y += 2;
      });
      y += 2;
    }

    if (d.manutencao_preventiva_relacionada && d.manutencao_preventiva_relacionada.length > 0) {
      y = this.ensureSpace(doc, y, 10);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text('Aproveite o pit stop', this.margin, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      d.manutencao_preventiva_relacionada.forEach((item) => {
        y = this.writeWrapped(doc, `+ ${item}`, this.margin, y, contentW);
        y += 1;
      });
      y += 2;
    }

    if (d.proxima_inspecao_recomendada) {
      y = this.ensureSpace(doc, y, 12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(8, 145, 178);
      y = this.writeWrapped(doc, 'Próxima inspeção:', this.margin, y, contentW);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      y = this.writeWrapped(doc, d.proxima_inspecao_recomendada, this.margin, y, contentW);
    }

    this.paintFooters(doc, pageW);
  }

  private writeSection(doc: jsPDF, title: string, body: string, y: number, contentW: number): number {
    y = this.ensureSpace(doc, y, 12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(title, this.margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
    y = this.writeWrapped(doc, body, this.margin, y, contentW);
    return y + 3;
  }

  private paintFooters(doc: jsPDF, pageW: number): void {
    const totalPages = doc.getNumberOfPages();
    const footerY = this.pageHeight(doc) - 8;
    for (let page = 1; page <= totalPages; page++) {
      doc.setPage(page);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(
        'Diagnóstico prévio assistido por IA - não substitui inspeção presencial qualificada.',
        this.margin,
        footerY
      );
      doc.text(`Página ${page}/${totalPages}`, pageW - this.margin, footerY, { align: 'right' });
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
    const safeText = this.sanitizeForPdf(text);
    const lines = doc.splitTextToSize(safeText, maxWidth) as string[];
    for (const line of lines) {
      y = this.ensureSpace(doc, y, this.lineH);
      doc.text(line, x, y);
      y += this.lineH;
    }
    return y;
  }

  /** Helvetica padrão do jsPDF não renderiza bem alguns símbolos Unicode. */
  private sanitizeForPdf(text: string): string {
    return text
      .replace(/\u2014|\u2013/g, '-')
      .replace(/\u00b7|\u2022/g, ' / ')
      .replace(/[\u2715\u2716\u2717\u2718]/g, 'X')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"');
  }
}
