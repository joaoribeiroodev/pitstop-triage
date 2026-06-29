import { Injectable } from '@angular/core';
import type jsPDF from 'jspdf';
import { PODE_DIRIGIR_LABEL } from '@core/constants/cdp-display';
import { rotulosZona } from '@core/data/sintomas.catalog';
import { DiagnosticoCdp } from '@core/models/cdp.model';
import { TriageSnapshot } from '@core/models/triage.model';

@Injectable({ providedIn: 'root' })
export class CdpPdfService {
  async generate(snapshot: TriageSnapshot, diagnostico: DiagnosticoCdp): Promise<jsPDF> {
    const { default: JsPDF } = await import('jspdf');
    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    this.paint(doc, snapshot, diagnostico);
    return doc;
  }

  private paint(doc: jsPDF, snapshot: TriageSnapshot, d: DiagnosticoCdp): void {
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = 20;

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 14, 'F');
    doc.setTextColor(251, 146, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('PITSTOP TRIAGE', margin, 9);
    doc.setTextColor(226, 232, 240);
    doc.setFontSize(9);
    doc.text('Código de Diagnóstico Prévio', pageW - margin, 9, { align: 'right' });

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('CDP — Diagnóstico Prévio', margin, (y = 26));
    y += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text(`Emitido em ${new Date().toLocaleString('pt-BR')}`, margin, y);
    y += 8;

    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, pageW - margin * 2, 30, 2, 2, 'FD');
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('VEÍCULO', margin + 4, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(
      `${snapshot.veiculo.marca} ${snapshot.veiculo.modelo} ${snapshot.veiculo.ano}`.trim() || '—',
      margin + 4,
      y + 13
    );
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `FIPE: ${snapshot.veiculo.codigoFipe || (snapshot.veiculo.origem === 'manual' ? 'Manual' : '—')}    Origem: ${snapshot.veiculo.origem || '—'}`,
      margin + 4,
      y + 20
    );
    doc.text(
      `Zona: ${rotulosZona[snapshot.zonaSelecionada] ?? snapshot.zonaSelecionada}    Sintomas: ${snapshot.sintomas.length}`,
      margin + 4,
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
    doc.setFillColor(r, g, b);
    doc.roundedRect(margin, y, 50, 9, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`URGÊNCIA ${d.urgencia_geral.toUpperCase()}`, margin + 25, y + 6, { align: 'center' });

    doc.setFillColor(15, 23, 42);
    doc.roundedRect(margin + 54, y, 80, 9, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(PODE_DIRIGIR_LABEL[d.pode_dirigir].label.toUpperCase(), margin + 94, y + 6, { align: 'center' });
    y += 16;

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Risco principal', margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
    y = this.writeWrapped(doc, d.risco_principal, margin, y, pageW - margin * 2);
    y += 3;

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('Resumo para o cliente', margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    y = this.writeWrapped(doc, d.resumo_para_cliente, margin, y, pageW - margin * 2);
    y += 3;

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('Observações de segurança', margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    y = this.writeWrapped(doc, d.observacoes_seguranca, margin, y, pageW - margin * 2);
    y += 3;

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('Ações imediatas', margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    d.acoes_imediatas.forEach((acao, index) => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      y = this.writeWrapped(doc, `${index + 1}. ${acao}`, margin, y, pageW - margin * 2);
    });
    y += 4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    if (y > 240) {
      doc.addPage();
      y = 20;
    }
    doc.text('Hipóteses técnicas', margin, y);
    y += 6;

    d.hipoteses.forEach((hipotese, index) => {
      if (y > 240) {
        doc.addPage();
        y = 20;
      }
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, y, pageW - margin * 2, 7, 1.5, 1.5, 'F');
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.text(`${index + 1}. ${hipotese.titulo}`, margin + 2, y + 4.7);
      doc.setTextColor(8, 145, 178);
      doc.text(`${hipotese.probabilidade}% · conf. ${hipotese.confianca}`, pageW - margin - 2, y + 4.7, {
        align: 'right'
      });
      y += 10;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(`Sistema: ${hipotese.sistema_afetado}`, margin, y);
      y += 5;
      doc.text(
        `Custo: R$ ${hipotese.custo_estimado_brl.min}–${hipotese.custo_estimado_brl.max}    Tempo: ${hipotese.tempo_reparo_horas.min}–${hipotese.tempo_reparo_horas.max}h`,
        margin,
        y
      );
      y += 5;

      doc.setFontSize(10);
      doc.setTextColor(51, 65, 85);
      y = this.writeWrapped(doc, hipotese.justificativa_tecnica, margin, y, pageW - margin * 2);
      y += 2;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(8, 145, 178);
      y = this.writeWrapped(
        doc,
        `Evidências: ${hipotese.evidencias_usadas.join(' · ')}`,
        margin,
        y,
        pageW - margin * 2
      );

      doc.setTextColor(234, 88, 12);
      y = this.writeWrapped(
        doc,
        `Verificar: ${hipotese.componentes_a_verificar.map((c) => `${c.nome} [${c.prioridade}]`).join(' · ')}`,
        margin,
        y,
        pageW - margin * 2
      );

      if (hipotese.codigos_obd_possiveis && hipotese.codigos_obd_possiveis.length > 0) {
        doc.setTextColor(8, 145, 178);
        y = this.writeWrapped(
          doc,
          `OBD: ${hipotese.codigos_obd_possiveis.join(', ')}`,
          margin,
          y,
          pageW - margin * 2
        );
      }
      y += 5;
    });

    if (d.diagnosticos_descartados && d.diagnosticos_descartados.length > 0) {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text('Diagnósticos descartados', margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      d.diagnosticos_descartados.forEach((descartado) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        y = this.writeWrapped(
          doc,
          `✕ ${descartado.titulo} — ${descartado.motivo_descarte}`,
          margin,
          y,
          pageW - margin * 2
        );
      });
    }

    const totalPages = doc.getNumberOfPages();
    for (let page = 1; page <= totalPages; page++) {
      doc.setPage(page);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(
        'Diagnóstico prévio assistido por IA — não substitui inspeção presencial qualificada.',
        margin,
        doc.internal.pageSize.getHeight() - 8
      );
      doc.text(`Página ${page}/${totalPages}`, pageW - margin, doc.internal.pageSize.getHeight() - 8, {
        align: 'right'
      });
    }
  }

  private writeWrapped(doc: jsPDF, text: string, x: number, y: number, maxWidth: number): number {
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    lines.forEach((line) => {
      if (y > doc.internal.pageSize.getHeight() - 16) {
        doc.addPage();
        y = 20;
      }
      doc.text(line, x, y);
      y += 5;
    });
    return y;
  }
}
