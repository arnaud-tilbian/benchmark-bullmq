#!/usr/bin/env bun
/**
 * BullMQ Benchmark Terminal UI
 * 
 * A terminal-based dashboard for analyzing benchmark results using OpenTUI.
 * 
 * Usage:
 *   bun benchmark-tui.ts                           # Auto-detect latest CSV
 *   bun benchmark-tui.ts benchmark_results_*.csv   # Specific file
 */

import { createCliRenderer, Box, Text, ScrollBox, t, bold, dim } from "@opentui/core"
import { readFileSync, readdirSync } from "fs"

// ============================================================================
// Types
// ============================================================================

interface BenchmarkResult {
  database: string
  threads: number
  queues: number
  readers: number
  writers: number
  duration: number
  total_writes: number
  writes_per_sec: number
  total_reads: number
  reads_per_sec: number
}

interface DatabaseStats {
  name: string
  color: string
  peakWrites: BenchmarkResult | null
  peakReads: BenchmarkResult | null
  avgWritesPerSec: number
  avgReadsPerSec: number
  results: BenchmarkResult[]
}

interface HeatmapCell {
  threads: number
  queues: number
  value: number
  intensity: number  // 0-4 for intensity levels
}

interface RatioData {
  database: string
  color: string
  peakWrites: number
  peakReads: number
  ratio: number
}

interface EfficiencyEntry {
  database: string
  config: string
  score: number
  writes: number
  reads: number
  color: string
}

interface ScalabilityPoint {
  threads: number
  value: number
  changePercent: number | null
}

interface ScalabilityData {
  database: string
  color: string
  points: ScalabilityPoint[]
  trend: "excellent" | "good" | "moderate" | "degrades" | "na"
}

interface VarianceData {
  database: string
  color: string
  writeCV: number  // Coefficient of Variation (%)
  readCV: number
  writeStability: "stable" | "moderate" | "unstable"
  readStability: "stable" | "moderate" | "unstable"
}

// ============================================================================
// Constants
// ============================================================================

// Catppuccin Mocha Palette
// https://github.com/catppuccin/catppuccin
const mocha = {
  // Accent colors
  rosewater: "#f5e0dc",
  flamingo: "#f2cdcd",
  pink: "#f5c2e7",
  mauve: "#cba6f7",
  red: "#f38ba8",
  maroon: "#eba0ac",
  peach: "#fab387",
  yellow: "#f9e2af",
  green: "#a6e3a1",
  teal: "#94e2d5",
  sky: "#89dceb",
  sapphire: "#74c7ec",
  blue: "#89b4fa",
  lavender: "#b4befe",
  // Text colors
  text: "#cdd6f4",
  subtext1: "#bac2de",
  subtext0: "#a6adc8",
  // Overlay colors
  overlay2: "#9399b2",
  overlay1: "#7f849c",
  overlay0: "#6c7086",
  // Surface colors
  surface2: "#585b70",
  surface1: "#45475a",
  surface0: "#313244",
  // Base colors
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",
} as const

// Application-specific color mappings using Catppuccin Mocha
const COLORS = {
  // Database colors (mapped to closest Mocha equivalents)
  dragonfly: mocha.red,      // #f38ba8
  redis: mocha.peach,        // #fab387
  valkey: mocha.blue,        // #89b4fa
  // UI colors
  muted: mocha.subtext0,     // #a6adc8
  dim: mocha.overlay0,       // #6c7086 (for borders)
  bright: mocha.text,        // #cdd6f4
  // Additional semantic colors
  success: mocha.green,      // #a6e3a1
  warning: mocha.yellow,     // #f9e2af
  error: mocha.red,          // #f38ba8
  info: mocha.teal,          // #94e2d5
  lavender: mocha.lavender,  // #b4befe (for active borders)
} as const

// ============================================================================
// Data Loading & Processing
// ============================================================================

function findLatestCsvFile(): string | null {
  const files = readdirSync(".")
    .filter(f => f.startsWith("benchmark_results_") && f.endsWith(".csv"))
    .sort()
    .reverse()
  
  return files[0] || null
}

function parseCSV(content: string): BenchmarkResult[] {
  const lines = content.trim().split("\n")
  
  return lines.slice(1).filter(line => line.trim()).map(line => {
    const values = line.split(",")
    return {
      database: values[0],
      threads: parseInt(values[1], 10),
      queues: parseInt(values[2], 10),
      readers: parseInt(values[3], 10),
      writers: parseInt(values[4], 10),
      duration: parseInt(values[5], 10),
      total_writes: parseInt(values[6], 10),
      writes_per_sec: parseInt(values[7], 10),
      total_reads: parseInt(values[8], 10),
      reads_per_sec: parseInt(values[9], 10),
    }
  })
}

function loadBenchmarkData(filePath?: string): { data: BenchmarkResult[], filename: string } {
  const targetFile = filePath || findLatestCsvFile()
  
  if (!targetFile) {
    throw new Error("No benchmark CSV files found. Run benchmarks first.")
  }
  
  const content = readFileSync(targetFile, "utf-8")
  return {
    data: parseCSV(content),
    filename: targetFile,
  }
}

function computeStats(data: BenchmarkResult[]): Map<string, DatabaseStats> {
  const stats = new Map<string, DatabaseStats>()
  
  const byDb = new Map<string, BenchmarkResult[]>()
  for (const row of data) {
    if (!byDb.has(row.database)) {
      byDb.set(row.database, [])
    }
    byDb.get(row.database)!.push(row)
  }
  
  for (const [db, results] of byDb) {
    const peakWrites = results.reduce((best, r) => 
      !best || r.writes_per_sec > best.writes_per_sec ? r : best, null as BenchmarkResult | null)
    
    const peakReads = results.reduce((best, r) => 
      !best || r.reads_per_sec > best.reads_per_sec ? r : best, null as BenchmarkResult | null)
    
    const avgWritesPerSec = Math.round(
      results.reduce((sum, r) => sum + r.writes_per_sec, 0) / results.length
    )
    
    const avgReadsPerSec = Math.round(
      results.reduce((sum, r) => sum + r.reads_per_sec, 0) / results.length
    )
    
    stats.set(db, {
      name: db,
      color: COLORS[db as keyof typeof COLORS] || COLORS.muted,
      peakWrites,
      peakReads,
      avgWritesPerSec,
      avgReadsPerSec,
      results,
    })
  }
  
  return stats
}

// ============================================================================
// Formatting Utilities
// ============================================================================

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toString()
}

function formatNumberFull(n: number): string {
  return n.toLocaleString()
}

function formatConfig(r: BenchmarkResult): string {
  return `${r.threads}T/${r.queues}Q`
}

function pad(str: string, len: number, right = false): string {
  if (str.length >= len) return str.slice(0, len)
  const padding = " ".repeat(len - str.length)
  return right ? str + padding : padding + str
}

// ============================================================================
// Analytics Computation Functions
// ============================================================================

function computeHeatmapData(
  results: BenchmarkResult[],
  metric: "writes_per_sec" | "reads_per_sec"
): Map<string, HeatmapCell[]> {
  const heatmaps = new Map<string, HeatmapCell[]>()
  
  // Group by database
  const byDb = new Map<string, BenchmarkResult[]>()
  for (const r of results) {
    if (!byDb.has(r.database)) byDb.set(r.database, [])
    byDb.get(r.database)!.push(r)
  }
  
  // Find global max for consistent scaling
  const globalMax = Math.max(...results.map(r => r[metric]))
  
  for (const [db, dbResults] of byDb) {
    const cells: HeatmapCell[] = []
    
    // Get best result for each threads/queues combination
    const combos = new Map<string, BenchmarkResult>()
    for (const r of dbResults) {
      const key = `${r.threads}-${r.queues}`
      if (!combos.has(key) || r[metric] > combos.get(key)![metric]) {
        combos.set(key, r)
      }
    }
    
    for (const r of combos.values()) {
      const ratio = r[metric] / globalMax
      // 0: ░ (0-25%), 1: ▒ (25-50%), 2: ▓ (50-75%), 3: █ (75-100%)
      const intensity = Math.min(3, Math.floor(ratio * 4))
      cells.push({
        threads: r.threads,
        queues: r.queues,
        value: r[metric],
        intensity,
      })
    }
    
    heatmaps.set(db, cells)
  }
  
  return heatmaps
}

function computeRatioData(stats: Map<string, DatabaseStats>): RatioData[] {
  const ratios: RatioData[] = []
  
  for (const [db, s] of stats) {
    const peakWrites = s.peakWrites?.writes_per_sec || 0
    const peakReads = s.peakReads?.reads_per_sec || 0
    const ratio = peakReads > 0 ? peakWrites / peakReads : 0
    
    ratios.push({
      database: db,
      color: s.color,
      peakWrites,
      peakReads,
      ratio,
    })
  }
  
  return ratios.sort((a, b) => b.ratio - a.ratio)
}

function computeEfficiencyScores(
  data: BenchmarkResult[],
  writeWeight = 0.6,
  readWeight = 0.4
): EfficiencyEntry[] {
  const maxWrites = Math.max(...data.map(r => r.writes_per_sec))
  const maxReads = Math.max(...data.map(r => r.reads_per_sec))
  
  const entries: EfficiencyEntry[] = data.map(r => {
    const normalizedWrites = r.writes_per_sec / maxWrites
    const normalizedReads = r.reads_per_sec / maxReads
    const score = (normalizedWrites * writeWeight + normalizedReads * readWeight) * 100
    
    return {
      database: r.database,
      config: `${r.threads}T/${r.queues}Q`,
      score,
      writes: r.writes_per_sec,
      reads: r.reads_per_sec,
      color: COLORS[r.database as keyof typeof COLORS] || COLORS.muted,
    }
  })
  
  return entries.sort((a, b) => b.score - a.score).slice(0, 10)
}

function computeScalability(
  data: BenchmarkResult[],
  metric: "writes_per_sec" | "reads_per_sec"
): ScalabilityData[] {
  const scalability: ScalabilityData[] = []
  
  // Group by database
  const byDb = new Map<string, BenchmarkResult[]>()
  for (const r of data) {
    if (!byDb.has(r.database)) byDb.set(r.database, [])
    byDb.get(r.database)!.push(r)
  }
  
  for (const [db, results] of byDb) {
    const threads = [...new Set(results.map(r => r.threads))].sort((a, b) => a - b)
    
    // Get best value per thread count
    const bestPerThread = new Map<number, number>()
    for (const r of results) {
      const current = bestPerThread.get(r.threads) || 0
      if (r[metric] > current) {
        bestPerThread.set(r.threads, r[metric])
      }
    }
    
    const baseline = bestPerThread.get(threads[0]) || 1
    const points: ScalabilityPoint[] = threads.map((t, i) => {
      const value = bestPerThread.get(t) || 0
      const changePercent = i === 0 ? null : ((value - baseline) / baseline) * 100
      return { threads: t, value, changePercent }
    })
    
    // Determine trend based on scaling
    let trend: ScalabilityData["trend"] = "na"
    if (points.length > 1) {
      const lastChange = points[points.length - 1].changePercent
      if (lastChange === null) trend = "na"
      else if (lastChange > 50) trend = "excellent"
      else if (lastChange > 20) trend = "good"
      else if (lastChange > -10) trend = "moderate"
      else trend = "degrades"
    }
    
    scalability.push({
      database: db,
      color: COLORS[db as keyof typeof COLORS] || COLORS.muted,
      points,
      trend,
    })
  }
  
  return scalability
}

function computeVariance(stats: Map<string, DatabaseStats>): VarianceData[] {
  const variances: VarianceData[] = []
  
  for (const [db, s] of stats) {
    const writes = s.results.map(r => r.writes_per_sec)
    const reads = s.results.map(r => r.reads_per_sec)
    
    // Calculate standard deviation and CV
    const calcCV = (values: number[]): number => {
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
      const stdDev = Math.sqrt(variance)
      return (stdDev / mean) * 100  // CV as percentage
    }
    
    const writeCV = calcCV(writes)
    const readCV = calcCV(reads)
    
    // Categorize stability
    const getStability = (cv: number): "stable" | "moderate" | "unstable" => {
      if (cv < 15) return "stable"
      if (cv < 35) return "moderate"
      return "unstable"
    }
    
    variances.push({
      database: db,
      color: s.color,
      writeCV,
      readCV,
      writeStability: getStability(writeCV),
      readStability: getStability(readCV),
    })
  }
  
  return variances.sort((a, b) => a.writeCV - b.writeCV)
}

// ============================================================================
// UI Components
// ============================================================================

function Header() {
  return Box(
    { width: "100%", marginBottom: 1 },
    Text({ content: t`${bold("BullMQ Benchmark Results")}` }),
  )
}

function PeakBanner(stats: Map<string, DatabaseStats>) {
  let peakWrite = { value: 0, db: "", config: "" }
  let peakRead = { value: 0, db: "", config: "" }
  
  for (const [db, s] of stats) {
    if (s.peakWrites && s.peakWrites.writes_per_sec > peakWrite.value) {
      peakWrite = { value: s.peakWrites.writes_per_sec, db, config: formatConfig(s.peakWrites) }
    }
    if (s.peakReads && s.peakReads.reads_per_sec > peakRead.value) {
      peakRead = { value: s.peakReads.reads_per_sec, db, config: formatConfig(s.peakReads) }
    }
  }
  
  const wColor = COLORS[peakWrite.db as keyof typeof COLORS] || COLORS.bright
  const rColor = COLORS[peakRead.db as keyof typeof COLORS] || COLORS.bright
  
  const writeVal = formatNumberFull(peakWrite.value) + "/s"
  const readVal = formatNumberFull(peakRead.value) + "/s"
  
  const bannerContent = [
    "PEAK PERFORMANCE",
    `Write: ${writeVal} (${peakWrite.db} @ ${peakWrite.config})    Read: ${readVal} (${peakRead.db} @ ${peakRead.config})`,
  ].join("\n")
  
  return Box(
    {
      width: "100%",
      height: 6,
      borderStyle: "rounded",
      borderColor: COLORS.dim,
      padding: 1,
      marginBottom: 1,
    },
    Text({ content: t`${dim(bannerContent)}` }),
  )
}

function StatsCard(s: DatabaseStats, width: number) {
  const color = s.color
  const name = s.name.charAt(0).toUpperCase() + s.name.slice(1)
  
  const pw = s.peakWrites ? `${formatNumber(s.peakWrites.writes_per_sec)}/s` : "N/A"
  const pwc = s.peakWrites ? formatConfig(s.peakWrites) : ""
  const pr = s.peakReads ? `${formatNumber(s.peakReads.reads_per_sec)}/s` : "N/A"
  const prc = s.peakReads ? formatConfig(s.peakReads) : ""
  const aw = `${formatNumber(s.avgWritesPerSec)}/s`
  const ar = `${formatNumber(s.avgReadsPerSec)}/s`
  
  const content = [
    name,
    "",
    `Peak W: ${pad(pw, 10, true)}${pwc}`,
    `Peak R: ${pad(pr, 10, true)}${prc}`,
    `Avg W:  ${aw}`,
    `Avg R:  ${ar}`,
  ].join("\n")
  
  return Box(
    {
      width,
      height: 10,
      borderStyle: "rounded",
      borderColor: color,
      padding: 1,
    },
    Text({ content, fg: color }),
  )
}

function StatsRow(stats: Map<string, DatabaseStats>) {
  const order = ["dragonfly", "redis", "valkey"]
  const available = order.filter(db => stats.has(db))
  const cardWidth = 32
  
  return Box(
    { width: "100%", height: 12, flexDirection: "row", gap: 1, marginBottom: 1 },
    ...available.map(db => StatsCard(stats.get(db)!, cardWidth)),
  )
}

function createBar(value: number, maxValue: number, width: number): string {
  const ratio = Math.min(value / maxValue, 1)
  const filled = Math.round(ratio * width)
  return "█".repeat(filled) + " ".repeat(width - filled)
}

function SimpleBarChart(title: string, data: BenchmarkResult[], metric: "writes_per_sec" | "reads_per_sec") {
  const threads = [...new Set(data.map(r => r.threads))].sort((a, b) => a - b)
  const maxVal = Math.max(...data.map(r => r[metric]))
  
  const barRows: { label: string, bar: string, val: string, db: string, color: string }[] = []
  
  for (const thread of threads) {
    const results = data.filter(r => r.threads === thread)
    const best = results.reduce((a, b) => b[metric] > a[metric] ? b : a)
    const bar = createBar(best[metric], maxVal, 15)
    const dbColor = COLORS[best.database as keyof typeof COLORS] || COLORS.muted
    const val = pad(formatNumber(best[metric]), 7)
    const db = pad(best.database, 10, true)
    barRows.push({ label: pad(thread + "T", 4), bar, val, db, color: dbColor })
  }
  
  // Height = 2 (border) + 2 (padding) + 2 (title + blank) + (threads.length * 2 - 1) (data rows + spacing)
  const chartHeight = 2 + 2 + 2 + (threads.length * 2 - 1)
  
  return Box(
    { flexGrow: 1, height: chartHeight, borderStyle: "rounded", borderColor: COLORS.dim, padding: 1, flexDirection: "column" },
    Text({ content: title }),
    Text({ content: "" }),
    ...barRows.flatMap((row, i) => {
      const rowText = Box(
        { flexDirection: "row" },
        Text({ content: `${row.label} ` }),
        Text({ content: row.bar, fg: row.color }),
        Text({ content: ` ${row.val} ${row.db}` }),
      )
      return i < barRows.length - 1 ? [rowText, Text({ content: "" })] : [rowText]
    }),
  )
}

function ChartsRow(data: BenchmarkResult[]) {
  // Calculate height based on thread count (same as SimpleBarChart)
  const threads = [...new Set(data.map(r => r.threads))].sort((a, b) => a - b)
  const chartHeight = 2 + 2 + 2 + (threads.length * 2 - 1)
  
  return Box(
    { width: "100%", height: chartHeight, flexDirection: "row", gap: 1, marginBottom: 1 },
    SimpleBarChart("Writes by Thread Count", data, "writes_per_sec"),
    SimpleBarChart("Reads by Thread Count", data, "reads_per_sec"),
  )
}

function DataTable(data: BenchmarkResult[]) {
  const sorted = [...data].sort((a, b) => b.writes_per_sec - a.writes_per_sec)
  const top = sorted.slice(0, 8)
  
  const header = `${pad("Database", 12, true)}${pad("T", 4)}${pad("Q", 4)}${pad("Writes/s", 12)}${pad("Reads/s", 12)}`
  const sep = "─".repeat(44)
  
  const lines: string[] = [
    `Top Results (showing ${top.length} of ${sorted.length})`,
    "",
    header,
    sep,
  ]
  
  for (const r of top) {
    const db = r.database.charAt(0).toUpperCase() + r.database.slice(1)
    lines.push(`${pad(db, 12, true)}${pad(r.threads.toString(), 4)}${pad(r.queues.toString(), 4)}${pad(formatNumberFull(r.writes_per_sec), 12)}${pad(formatNumberFull(r.reads_per_sec), 12)}`)
  }
  
  // Height = 2 (border) + 2 (padding) + 4 (title, blank, header, sep) + top.length (data rows)
  const tableHeight = 2 + 2 + 4 + top.length
  
  return Box(
    { width: "100%", height: tableHeight, borderStyle: "rounded", borderColor: COLORS.dim, padding: 1, marginBottom: 1 },
    Text({ content: lines.join("\n") }),
  )
}

function Footer(filename: string) {
  return Box(
    { width: "100%" },
    Text({ content: t`${dim("Source: " + filename)}` }),
  )
}

// ============================================================================
// Analytics UI Components
// ============================================================================

function SectionTitle(title: string) {
  return Box(
    { width: "100%", marginTop: 1, marginBottom: 1 },
    Text({ content: t`${bold("═══ " + title + " ═══")}`, fg: COLORS.lavender }),
  )
}

const INTENSITY_CHARS = ["░", "▒", "▓", "█"]

function HeatmapSection(data: BenchmarkResult[], stats: Map<string, DatabaseStats>) {
  const heatmapData = computeHeatmapData(data, "writes_per_sec")
  const order = ["dragonfly", "redis", "valkey"]
  const available = order.filter(db => heatmapData.has(db))
  
  const threads = [...new Set(data.map(r => r.threads))].sort((a, b) => a - b)
  const queues = [...new Set(data.map(r => r.queues))].sort((a, b) => a - b)
  
  const heatmaps = available.map(db => {
    const cells = heatmapData.get(db) || []
    const color = COLORS[db as keyof typeof COLORS] || COLORS.muted
    const name = db.charAt(0).toUpperCase() + db.slice(1)
    
    // Build header row
    const headerRow = "      " + queues.map(q => pad(`Q${q}`, 6)).join("")
    
    // Build data rows
    const rows: string[] = [headerRow]
    for (const t of threads) {
      let row = pad(`${t}T`, 5) + " "
      for (const q of queues) {
        const cell = cells.find(c => c.threads === t && c.queues === q)
        if (cell) {
          const char = INTENSITY_CHARS[cell.intensity]
          const valStr = formatNumber(cell.value)
          row += pad(char + valStr, 6)
        } else {
          row += pad("-", 6)
        }
      }
      rows.push(row)
    }
    
    const content = rows.join("\n")
    const chartHeight = 2 + 2 + rows.length  // border + padding + rows
    
    return Box(
      { flexGrow: 1, height: chartHeight, borderStyle: "rounded", borderColor: color, padding: 1 },
      Text({ content: `${name} Writes/s\n\n${content}`, fg: color }),
    )
  })
  
  const chartHeight = 2 + 2 + 1 + threads.length + 1  // border + padding + header + rows + title
  
  return Box(
    { width: "100%", height: chartHeight + 2, flexDirection: "row", gap: 1, marginBottom: 1 },
    ...heatmaps,
  )
}

function RatioChart(stats: Map<string, DatabaseStats>) {
  const ratios = computeRatioData(stats)
  const maxWrites = Math.max(...ratios.map(r => r.peakWrites))
  
  const barWidth = 40
  const rows: string[] = []
  
  for (const r of ratios) {
    const name = pad(r.database.charAt(0).toUpperCase() + r.database.slice(1), 12, true)
    const writeRatio = r.peakWrites / (r.peakWrites + r.peakReads)
    const writeBars = Math.round(writeRatio * barWidth)
    const readBars = barWidth - writeBars
    
    const bar = "█".repeat(writeBars) + "░".repeat(readBars)
    const wVal = formatNumber(r.peakWrites)
    const rVal = formatNumber(r.peakReads)
    const ratioStr = r.ratio.toFixed(1) + ":1"
    
    rows.push(`${name} ${bar}  ${pad(wVal, 6)}W │ ${pad(rVal, 5)}R │ ${ratioStr}`)
  }
  
  const legend = "████ Writes   ░░░░ Reads"
  const content = rows.join("\n") + "\n\n" + legend
  
  const chartHeight = 2 + 2 + ratios.length + 2  // border + padding + rows + legend
  
  return Box(
    { width: "100%", height: chartHeight, borderStyle: "rounded", borderColor: COLORS.dim, padding: 1, marginBottom: 1 },
    Text({ content: `Write/Read Ratio (Peak)\n\n${content}` }),
  )
}

function EfficiencyChart(data: BenchmarkResult[]) {
  const scores = computeEfficiencyScores(data)
  const maxScore = 100
  const barWidth = 35
  
  const rows: string[] = []
  
  scores.forEach((entry, i) => {
    const rank = pad(`#${i + 1}`, 3)
    const name = pad(entry.database.charAt(0).toUpperCase() + entry.database.slice(1), 11, true)
    const config = pad(entry.config, 8, true)
    const scorePct = entry.score / maxScore
    const filled = Math.round(scorePct * barWidth)
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled)
    const scoreStr = pad(entry.score.toFixed(1), 5)
    const detail = `(${formatNumber(entry.writes)}/${formatNumber(entry.reads)})`
    
    rows.push(`${rank} ${name} ${config} ${bar} ${scoreStr}  ${detail}`)
  })
  
  const formula = "Score = 0.6×writes + 0.4×reads (normalized)"
  const content = formula + "\n\n" + rows.join("\n")
  
  const chartHeight = 2 + 2 + 2 + scores.length  // border + padding + formula + rows
  
  return Box(
    { width: "100%", height: chartHeight, borderStyle: "rounded", borderColor: COLORS.dim, padding: 1, marginBottom: 1 },
    Text({ content: `Efficiency Score\n\n${content}` }),
  )
}

function ComparativeChart(data: BenchmarkResult[]) {
  const order = ["dragonfly", "redis", "valkey"]
  const markers = { dragonfly: "●", redis: "○", valkey: "◇" }
  const threads = [...new Set(data.map(r => r.threads))].sort((a, b) => a - b)
  
  // Get best writes per thread per database
  const byDb = new Map<string, Map<number, number>>()
  for (const db of order) {
    byDb.set(db, new Map())
  }
  
  for (const r of data) {
    if (!order.includes(r.database)) continue
    const dbMap = byDb.get(r.database)!
    const current = dbMap.get(r.threads) || 0
    if (r.writes_per_sec > current) {
      dbMap.set(r.threads, r.writes_per_sec)
    }
  }
  
  // Calculate Y-axis range
  let maxVal = 0
  for (const dbMap of byDb.values()) {
    for (const v of dbMap.values()) {
      if (v > maxVal) maxVal = v
    }
  }
  
  const chartHeight = 8
  const chartWidth = threads.length * 8
  const ySteps = [0, 0.25, 0.5, 0.75, 1].map(r => Math.round(maxVal * r))
  
  // Build ASCII chart
  const grid: string[][] = []
  for (let y = 0; y < chartHeight; y++) {
    grid.push(new Array(chartWidth).fill(" "))
  }
  
  // Plot points for each database
  for (const [db, dbMap] of byDb) {
    const marker = markers[db as keyof typeof markers]
    threads.forEach((t, xi) => {
      const val = dbMap.get(t)
      if (val !== undefined) {
        const yi = chartHeight - 1 - Math.round((val / maxVal) * (chartHeight - 1))
        const x = xi * 8 + 4
        if (x < chartWidth && yi >= 0 && yi < chartHeight) {
          grid[yi][x] = marker
        }
      }
    })
  }
  
  // Build output with Y-axis labels
  const rows: string[] = []
  for (let y = 0; y < chartHeight; y++) {
    const yVal = Math.round(maxVal * (1 - y / (chartHeight - 1)))
    const yLabel = pad(formatNumber(yVal), 6)
    rows.push(`${yLabel} ┤${grid[y].join("")}`)
  }
  
  // X-axis
  const xAxis = "       └" + threads.map(t => pad(`${t}T`, 8)).join("")
  rows.push(xAxis)
  
  // Legend
  const legend = order
    .filter(db => byDb.get(db)!.size > 0)
    .map(db => {
      const m = markers[db as keyof typeof markers]
      const color = COLORS[db as keyof typeof COLORS]
      return `${m} ${db.charAt(0).toUpperCase() + db.slice(1)}`
    })
    .join("    ")
  
  const content = rows.join("\n") + "\n\n" + legend
  const totalHeight = 2 + 2 + chartHeight + 3  // border + padding + chart + xaxis + legend
  
  return Box(
    { width: "100%", height: totalHeight, borderStyle: "rounded", borderColor: COLORS.dim, padding: 1, marginBottom: 1 },
    Text({ content: `Writes/sec Comparison\n\n${content}` }),
  )
}

function ScalabilityChart(data: BenchmarkResult[]) {
  const scalability = computeScalability(data, "writes_per_sec")
  const order = ["dragonfly", "redis", "valkey"]
  
  const trendLabels = {
    excellent: "Excellent scaling",
    good: "Good scaling",
    moderate: "Moderate",
    degrades: "Degrades with threads",
    na: "N/A",
  }
  
  const rows: string[] = []
  
  for (const db of order) {
    const s = scalability.find(x => x.database === db)
    if (!s) continue
    
    const name = pad(s.database.charAt(0).toUpperCase() + s.database.slice(1) + ":", 12, true)
    
    if (s.points.length <= 1) {
      rows.push(`${name} (single configuration, no scaling data)`)
      rows.push("")
      continue
    }
    
    // Build scaling chain
    const chain = s.points.map((p, i) => {
      if (i === 0) return `${p.threads}T`
      const sign = p.changePercent! >= 0 ? "+" : ""
      return `${p.threads}T (${sign}${p.changePercent!.toFixed(0)}%)`
    }).join(" → ")
    
    // Build progress bar
    const maxChange = Math.max(...s.points.filter(p => p.changePercent !== null).map(p => Math.abs(p.changePercent!)))
    const lastChange = s.points[s.points.length - 1].changePercent || 0
    const barWidth = 30
    
    let bar: string
    if (lastChange >= 0) {
      const filled = Math.min(Math.round((lastChange / 100) * barWidth), barWidth)
      bar = "█".repeat(filled) + "░".repeat(barWidth - filled)
    } else {
      const filled = Math.min(Math.round((Math.abs(lastChange) / 100) * barWidth), barWidth)
      bar = "█".repeat(barWidth - filled) + "░".repeat(filled)
    }
    
    rows.push(`${name} ${chain}`)
    rows.push(`             ${bar}  ${trendLabels[s.trend]}`)
    rows.push("")
  }
  
  const content = rows.join("\n")
  const totalHeight = 2 + 2 + 2 + order.length * 3  // border + padding + title + rows
  
  return Box(
    { width: "100%", height: totalHeight, borderStyle: "rounded", borderColor: COLORS.dim, padding: 1, marginBottom: 1 },
    Text({ content: `Scalability (% change from 1T baseline)\n\n${content}` }),
  )
}

function VarianceChart(stats: Map<string, DatabaseStats>) {
  const variances = computeVariance(stats)
  const maxCV = Math.max(...variances.flatMap(v => [v.writeCV, v.readCV]))
  const barWidth = 20
  
  const stabilityLabel = {
    stable: "Stable",
    moderate: "Moderate",
    unstable: "Unstable",
  }
  
  // Writes section
  const writeRows: string[] = ["WRITES"]
  const sortedByWrite = [...variances].sort((a, b) => a.writeCV - b.writeCV)
  for (const v of sortedByWrite) {
    const name = pad(v.database.charAt(0).toUpperCase() + v.database.slice(1), 12, true)
    const filled = Math.round((v.writeCV / maxCV) * barWidth)
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled)
    const cvStr = pad(v.writeCV.toFixed(1) + "%", 7)
    writeRows.push(`${name} ${bar} ${cvStr} ${stabilityLabel[v.writeStability]}`)
  }
  
  // Reads section
  const readRows: string[] = ["READS"]
  const sortedByRead = [...variances].sort((a, b) => a.readCV - b.readCV)
  for (const v of sortedByRead) {
    const name = pad(v.database.charAt(0).toUpperCase() + v.database.slice(1), 12, true)
    const filled = Math.round((v.readCV / maxCV) * barWidth)
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled)
    const cvStr = pad(v.readCV.toFixed(1) + "%", 7)
    readRows.push(`${name} ${bar} ${cvStr} ${stabilityLabel[v.readStability]}`)
  }
  
  // Most stable summary
  const mostStableWrite = sortedByWrite[0]
  const mostStableRead = sortedByRead[0]
  const summary = `Most stable: ${mostStableWrite.database} (writes)  │  ${mostStableRead.database} (reads)`
  
  const content = [
    "Lower CV% = More Predictable",
    "",
    ...writeRows,
    "",
    ...readRows,
    "",
    summary,
  ].join("\n")
  
  const totalHeight = 2 + 2 + 4 + variances.length * 2 + 3  // border + padding + header + data + summary
  
  return Box(
    { width: "100%", height: totalHeight, borderStyle: "rounded", borderColor: COLORS.dim, padding: 1, marginBottom: 1 },
    Text({ content: `Performance Stability (Coefficient of Variation)\n\n${content}` }),
  )
}

// ============================================================================
// Main Application
// ============================================================================

async function main() {
  const args = process.argv.slice(2)
  const inputFile = args[0]
  
  let benchmarkData: { data: BenchmarkResult[], filename: string }
  try {
    benchmarkData = loadBenchmarkData(inputFile)
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`)
    process.exit(1)
  }
  
  const { data, filename } = benchmarkData
  const stats = computeStats(data)
  
  const renderer = await createCliRenderer({ exitOnCtrlC: true })
  
  // Create a unique ID for the scroll box
  const scrollBoxId = "main-scroll"
  
  const scrollBox = ScrollBox(
    { 
      id: scrollBoxId,
      width: "100%", 
      height: "100%", 
      scrollY: true,
      scrollX: false,
    },
    Box(
      { width: "100%", flexDirection: "column", padding: 1 },
      Header(),
      PeakBanner(stats),
      StatsRow(stats),
      ChartsRow(data),
      // Analytics Section
      SectionTitle("Analytics"),
      HeatmapSection(data, stats),
      RatioChart(stats),
      EfficiencyChart(data),
      ComparativeChart(data),
      ScalabilityChart(data),
      VarianceChart(stats),
      // Data & Footer
      DataTable(data),
      Footer(filename),
    ),
  )
  
  renderer.root.add(scrollBox)
  
  // Focus the ScrollBox to enable keyboard scrolling
  const scrollBoxRenderable = renderer.root.getRenderable(scrollBoxId) as any
  if (scrollBoxRenderable?.focus) {
    scrollBoxRenderable.focus()
  }
}

main().catch(console.error)
