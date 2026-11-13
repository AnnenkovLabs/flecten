import { memoryDigest } from "../../src/core/memory/sources";
import type { MemoryWrite } from "../../src/core/memory/types";

export interface ExperienceScenario {
  id: string;
  seed: MemoryWrite[];
  prompts: string[];
  artifact: string;
  expected: string;
  maximumActive?: number;
}

function memory(key: string, summary: string, content: string, topic: string): MemoryWrite {
  const quote = `A durable project requirement: ${content}`;
  return {
    key,
    kind: "preference",
    summary,
    content,
    topics: [topic],
    appliesWhen: `Working on ${topic}`,
    reason: "Prior explicit correction unavailable in project files.",
    cues: [],
    priority: "normal",
    sources: [
      {
        role: "user",
        quote,
        sessionId: "prior-session",
        reference: "user:0",
        digest: memoryDigest(quote),
      },
    ],
  };
}

export function experienceScenarios(): ExperienceScenario[] {
  const reporting = memory(
    "reports/serialization",
    "Serialization convention",
    "For client-facing diagnostic exports, write the exact CSV header route_key,arrival_window,revision_tag. This is a transport export convention, not a UI text preference.",
    "Client diagnostic exports",
  );
  const noise = Array.from({ length: 200 }, (_, index) =>
    memory(
      `unrelated/${index}`,
      `Stable choice ${index}`,
      `For archived sample ${index}, its badge identifier is archived-${index}. This applies only to that archived sample.`,
      [
        "Archived illustrations",
        "Historical sound samples",
        "Retired demo palettes",
        "Old tutorial conventions",
      ][index % 4] ?? "Archives",
    ),
  );
  return [
    {
      id: "old-cross-language-record",
      seed: [reporting, ...noise],
      prompts: [
        "Создай файл delivery.csv для клиентской выгрузки диагностики перевозок. В нём нужна только строка названий колонок по нашим прежним договорённостям. Никаких данных. Заверши задачу после записи файла.",
      ],
      artifact: "delivery.csv",
      expected: "route_key,arrival_window,revision_tag",
    },
    {
      id: "withdrawn-conflicting-records",
      seed: [
        memory(
          "reports/title-a",
          "Permanent report title",
          "Name the diagnostic report Node Passport.",
          "Report names",
        ),
        memory(
          "reports/title-b",
          "Report title in exports",
          "Use Node Passport for exported diagnostic report titles.",
          "Report names",
        ),
      ],
      prompts: [
        "Мы окончательно изменили название диагностического отчёта на Route Ledger. Старое название Node Passport отозвано во всех вариантах, включая экспорт. Исправь устаревшие договорённости и создай report-title.txt с новым названием. Заверши задачу.",
        "Создай final-title.txt с принятым названием диагностического отчёта, без пояснений. Заверши задачу.",
      ],
      artifact: "final-title.txt",
      expected: "Route Ledger",
      maximumActive: 1,
    },
    {
      id: "unprompted-durable-correction",
      seed: [],
      prompts: [
        "Мы несколько раз исправляли одно и то же: постоянный заголовок проекта для диагностических отчётов должен быть Transit Journal. Название Network Passport больше не используй. Создай accepted-title.txt с правильным заголовком и заверши задачу.",
        "Создай remembered-title.txt с согласованным заголовком диагностического отчёта нашего проекта. Заверши задачу.",
      ],
      artifact: "remembered-title.txt",
      expected: "Transit Journal",
      maximumActive: 1,
    },
    {
      id: "one-off-instruction",
      seed: [],
      prompts: [
        "Только для этой временной заглушки создай scratch.txt с единственной строкой временный_ярлык. Это одноразовые данные текущего задания. Заверши задачу.",
        "Создай health.txt с единственной строкой ready. Заверши задачу.",
      ],
      artifact: "health.txt",
      expected: "ready",
      maximumActive: 0,
    },
  ];
}
