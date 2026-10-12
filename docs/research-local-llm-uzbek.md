# Local LLM for offline Uzbek call analysis (replacing the Gemini step)

Research date: 2026-10-12. All claims below are linked to the primary source that owns them.
Anything I could not verify from a primary source is marked **[UNVERIFIED]** or **[NOT FOUND]**.

## TL;DR recommendation

**Deploy `Qwen/Qwen3.5-4B` at Q5_K_M or Q6_K in GGUF, via llama.cpp (`llama-server`) or Ollama,
with a JSON-Schema-constrained decode (LLGuidance / Ollama `format`), in non-thinking mode.**

Second choice: `Qwen/Qwen3.5-9B` at Q4_K_M if you have ~16 GB RAM and can tolerate ~3× the latency.

Then **fine-tune it on ~300–1000 real Suhbatdosh call transcripts** using the existing
`CallAnalysis` Pydantic schema as the target. No off-the-shelf open model is anywhere near Gemini
on the *quality* axis; they are, however, good enough on the *reliability* axis to make
fine-tuning cheap and worthwhile.

---

## 1. What is the standard way to measure Uzbek LLM quality?

Two benchmarks exist. Only one is peer-reviewed.

### 1a. TUMLU — the credible one

[arXiv:2502.11020](https://arxiv.org/html/2502.11020v1) — *TUMLU: A Unified and Native Language
Understanding Benchmark for Turkic Languages*, Findings of ACL 2025. Covers 8 Turkic languages
including **Uzbek**, in both Latin and Cyrillic, 38,139 questions / 11 subjects. Native-authored,
not machine-translated. Code + data: `github.com/ceferisbarov/TUMLU`.

5-shot accuracy on the **Uzbek** subset (Table 2):

| Model | uzb (5-shot) |
|---|---|
| Claude 3.5 Sonnet | 68.6 |
| GPT-4o | 65.4 |
| Gemini 1.5 Pro | 61.1 |
| Gemini 1.5 Flash | 50.0 |
| **Qwen2.5 72B** | **50.4** |
| Llama 3.3 70B | 44.1 |
| Gemma 2 27B | 36.9 |
| **Qwen2.5 7B** | **34.6** |
| Gemma 2 9B | 36.1 |
| **Llama 3.1 8B** | **29.9** |

**This is the single most important table in this document.** Note that:
- No 7–8B open model clears ~37%. Random is 25%.
- You need ~72B to reach 50%.
- You need a frontier API model to reach 65–70%.

The paper's own conclusion (§6) is the crux of our problem:

> "LLMs have a reasonably good understanding of all 8 languages… However, LLMs are **less capable of
> generating text in these languages**, usually answering multiple-choice questions correctly, but
> in another, similar high-resource language."

That "Understanding OK / Generation bad" split is exactly the failure mode that matters for
Suhbatdosh, where we need fluent **Uzbek prose output** regardless of the input language. (§5.3 shows
models emitting Turkish-mixed output for Crimean Tatar.)

### 1b. UzLiB — the popular one, but treat with suspicion

[tahrirchi/uzlib](https://github.com/tahrirchi/uzlib) — *UzLiB, Uzbek Linguistic Benchmark*.
Multiple-choice, sourced from Uzbek-language Telegram quiz channels (Orif Tolib,
Тўғри ёзамиз, Tahrir.uz, Tahrirchi). First and most-cited Uzbek-specific LLM benchmark. Leaderboard:
`uzlib/LEADERBOARD.md`.

Extract of the leaderboard (as of 2026-10-12), **open/local models only**:

| Model | UzLiB overall |
|---|---|
| NeuronAI-o'zbek_tili (4B) — `NeuronUz/NeuronAI-Uzbek` | **0.662** |
| Gemma 4 31B | 0.5535 |
| Llama 4 Scout 17B | 0.5519 |
| Gemma 4 26B A4B | 0.5481 |
| Gemma 3 27B | 0.4949 |
| Gemma 3 12B | 0.468 |
| Mistral 7B Uz — `behbudiy/Mistral-7B-Instruct-Uz` | 0.4202 |
| Qwen3 8B | 0.3853 |
| Mistral Nemo Uz — `behbudiy/Mistral-Nemo-Instruct-Uz` | 0.3799 |
| Qwen3 14B | 0.3740 |
| Llama 3.1 8B | 0.3745 |
| Qwen3 4B | 0.3450 |
| Mistral 7B | 0.3246 |
| Llama 3.2 3B Uz — `bxod/Llama-3.2-3B-Instruct-uz` | 0.2832 |
| Llama 3.2 1B Uz — `bxod/Llama-3.2-1B-Instruct-uz` | 0.2456 |
| Llama 3.2 1B | 0.2332 |
| *Random baseline (as stated)* | *0.25* |
| *Human voters (as stated)* | *0.5894* |

**Read the footnote before you read the numbers.** The leaderboard itself notes that because the
original questions have a variable number of options (2–3 in some), "the random baseline for humans
is 0.4229." The tabulated 0.25 random baseline is misleading. Practically: **almost every open
local model on this board is scoring within noise of guessing.** Gemma 3 27B at 0.4949 and
Qwen3 8B at 0.3853 are not meaningfully different from a coin flip adjusted for option count.

The single standout — NeuronAI-Uzbek at 0.662, beating GPT-4o and Claude 3.5 Sonnet — is
**almost certainly contaminated**; see §2c.

**Not peer-reviewed, no held-out private split, self-reported scores.** Treat UzLiB as a smoke test,
not a selection criterion.

### 1c. "Open UEA" — [NOT FOUND]

I could not find any benchmark called "Open UEA", and I could not find "uzBench" either. If you
were given these names, they may be misremembered or hallucinated. The real options are UzLiB
(§1b) and TUMLU (§1a). Other multilingual suites that cover Uzbek exist (MMLU-ProX, MuBench,
Global-MMLU) but are machine-translated and much weaker discriminators for Uzbek specifically.

---

## 2. Base multilingual LLMs and their Uzbek support

### 2a. Qwen — the only major family that names Uzbek

**Qwen3** (May 2025). The official [Qwen3 release post](https://qwen.ai/blog?id=qwen3) lists
119 languages/dialects with an explicit Turkic row:

> Turkic | Turkish, North Azerbaijani, **Northern Uzbek**, Kazakh, Bashkir, Tatar

[Qwen3 Technical Report](https://arxiv.org/html/2505.09388v1) confirms multilingual support expanded
from Qwen2.5's 29 to 119. **Qwen is the only mainstream family I found that explicitly enumerates
Uzbek.** That is a real differentiator and the main reason it leads this shortlist.

Sizes: 0.6B / 1.7B / 4B / 8B / 14B / 32B dense, plus 30B-A3B and 235B-A22B MoE. Apache 2.0.
Context 32K (0.6B–4B) to 128K (8B+).

**Qwen3.5** (Feb/Mar 2026) — the current generation. Small-model series: **0.8B, 2B, 4B, 9B**
(released 2026-03-02), released 2026-03-04 in the sizes list. Apache 2.0.
The [Qwen3.5 post](https://qwen.ai/blog?id=qwen3.5) states:

> "Multilingual coverage grows from 119 to 201 languages/dialects; a 250k vocabulary (vs. 150k)
> boosts encoding/decoding efficiency by **10–60% across most languages**."

The [Qwen3.5-4B model card](https://huggingface.co/Qwen/Qwen3.5-4B) confirms: 248,320 token vocab,
262,144 native context (1,010,000 with YaRN), 32 layers, hidden 2560.

> **[UNVERIFIED]** Neither the Qwen3.5 blog nor the model card enumerates the 201 languages, so I
> could not confirm from a primary source that Uzbek is on that list. The claim rests on inference:
> Qwen3 lists Northern Uzbek, and 201 is an *expansion* of the same 119. Third-party summaries do
> mention Uzbek under "Central Asia." Treat as high-confidence but unconfirmed; **verify with a
> 20-prompt Uzbek smoke test before committing.**

Qwen3.5 arch note relevant to CPU deployment: these are natively **vision-language** models
(`image-text-to-text`, vision encoder fused in). HF lists Qwen3.5-4B as "5B params" total
(4B LM + ~1B vision). llama.cpp converts only the LLM portion for text use — GGUF of Qwen3.5-4B is
~4.2B / 2.5 GiB at Q4_K_M.

### 2b. Everyone else

| Family | Uzbek claim | Verified how |
|---|---|---|
| **Gemma 3** | Claims "140+ languages". **No Uzbek enumeration anywhere** — model card gives only Global-MMLU-Lite, Belebele, WMT24++ aggregates. | [HF blog](https://huggingface.co/blog/gemma3), [model card](https://huggingface.co/google/gemma-3-27b-it). The only explicit per-language table I found is a TranslateGemma thread where a Google engineer confirms `uz` codes exist in the jinja template but are **absent from the benchmarked 55** — "uz is in the jinja template, but not in the report." **[UNVERIFIED] whether Gemma 3 is actually trained on Uzbek.** Note **gemma-3-1b-it is English-only.** |
| **Gemma 4** | 31B scores 0.5535 on UzLiB — the strongest *non-Uzbek-specific* local model there. Too big for CPU. | uzlib LEADERBOARD.md |
| **Llama 3.x / 4** | **No Uzbek claim anywhere.** Meta lists 8 officially supported languages (en/de/es/fr/it/pt/hi/th), which excludes Uzbek. Llama 4 Scout scores 0.5519 on UzLiB, which is *better* than Llama 3.1 8B (0.3745) — likely an artifact of UzLiB's near-chance scale, not real Uzbek competence. | uzlib LEADERBOARD.md; Meta model cards |
| **Mistral** | No Uzbek claim. `Mistral 7B` = 0.3246, `Mistral Nemo` = 0.4095 on UzLiB — near chance. | uzlib LEADERBOARD.md |
| **Phi-4** | 0.3401 on UzLiB — near chance. | uzlib LEADERBOARD.md |
| **GLM / Kimi / MiniCPM / gpt-oss** | 0.38–0.55 on UzLiB, all near the same near-chance band. | uzlib LEADERBOARD.md |
| **OLMo** | [NOT ASSESSED] — no Uzbek eval found. | — |

### 2c. Uzbek-specific fine-tunes (the interesting part)

Three credible orgs. **Read the red flags.**

#### `NeuronUz/NeuronAI-Uzbek` — 4B, Qwen3-4B base, Apache-2.0. **DO NOT TRUST.**

Model card claims:
- UzLiB **0.662** vs Qwen3-4B's 0.345 (+91.9%), "4th place globally, 1st in Uzbekistan."
- Tokenizer fertility **2.67 vs 3.44** tokens/Uzbek-word (−22.5%), vocab 151,669 → 180,000 via
  "40,000 Uzbek-optimized tokens."
- Training: 2B tokens Uzbek+English CPT, then SFT on `behbudiy/alpaca-cleaned-uz`,
  `vicgalle/alpaca-gpt4`, and **`NeuronUz/uzbek-spelling-mcq`, whose stated purpose in the model
  card is literally "Benchmark-targeted training."**

**Why to reject it despite the top score:**
1. UzLiB is drawn from Uzbek **spelling/orthography Telegram quizzes**. A dataset literally named
   `uzbek-spelling-mcq` trained as SFT, then evaluated on a spelling-MCQ benchmark, is textbook
   benchmark contamination. The +104.6% on the "Correct Word" column (the spelling column) versus
   −4.0% on "Meaning in context" is the exact signature of this.
2. The tokenizer claim — a Qwen3 fine-tune with a *modified 180k vocab* but no architecture change —
   requires `trust_remote_code=True`, i.e. arbitrary Python in your inference process. That is a
   hard no for an offline corporate deployment.
3. The "#4 globally" claim is stale/false against the current leaderboard (it sits ~13th, behind
   Gemini 3 Pro, Claude Sonnet 5.5, etc.). Disregards its own leaderboard.
4. No chat template robustness evidence, no structured-output evidence, 454 downloads/month.

Its *fertility methodology* is sound and worth borrowing as a **diagnostic you run yourself**, but
not its weights.

#### `uzlm/alloma-{1B,3B,8B}-Instruct` — Uzbek LLM Lab. **Methodologically the most honest, technically awkward.**

Developed by Examy.me + Teamwork.uz. Continual pretraining of Llama 3.1/3.2 with **in-place
vocabulary replacement** — non-relevant non-ASCII tokens swapped for custom Uzbek BPE tokens, new
embeddings initialised by subtoken averaging. Claims **1.7 tokens per Uzbek word vs ~3.5 for base
Llama** (2× faster inference, longer effective context). Published full benchmark tables including
FLORES+ Uz↔En BLEU/COMET.

Reported gains vs base (from the model cards):
- `alloma-1B`: BLEU Uz→En 3.62 → 16.64; MMLU-uz 24.37 → 26.27
- `alloma-3B`: BLEU Uz→En 11.91 → 25.19; MMLU-uz 31.88 → 39.30
- `alloma-8B`: BLEU Uz→En 24.23 → 31.16; COMET Uz→En 83.12 → 87.24; MMLU-uz 40.51 → 41.89

The authors honestly disclose the cost: English MMLU **drops** (8B: 60.59 → 53.35) — "catastrophic
forgetting of original English instruction following." That directly hurts us, since our inputs are
often Russian and our schema is English-keyed.

**Red flags / deployment blockers:**
- **Mandatory input preprocessing.** The card instructs you to regex-replace every apostrophe variant
  (`’ ‘ ʻ ʼ ʽ ʾ ʿ ˈ '`) with the literal string `APST` before tokenizing, and reverse it after.
  Non-optional if you want their tokenizer fertility numbers. It also means their published eval
  numbers do **not** transfer to raw text.
- **Context too small.** `alloma-3B` was continually pretrained at **2048** context; `alloma-8B` at
  **4096**. A 2000-token transcript plus your system prompt plus a ~300-token JSON output will
  overflow. This alone disqualifies it for the upper end of your input range.
- **Licences are `llama3.1` / `llama3.2`**, not Apache — extra commercial terms, and the gated HF
  repos require accepting Meta's licence.
- Hand-rolled `system/user/assistant` string prompt instead of `apply_chat_template` — their example
  code doesn't use the model's own chat template. Integration risk.
- **Absent from UzLiB entirely.** Nobody has independently validated them on the standard Uzbek
  benchmark.
- Low adoption: 610 / 206 / 284 downloads per month.
- Authoritative context: `uzlm` is a 3-person org. `alloma` has only 9 likes on the 8B card.

#### `behbudiy/{Mistral-7B-Instruct-Uz, Mistral-Nemo-Instruct-Uz, Llama-3.1-8B-Instruct-Uz}` — stale but independently scored

Best genuine open small-model showing on UzLiB among models without a custom tokenizer
(Mistral-7B-Uz at 0.4202, Nemo-Uz at 0.3799). But: last updated **2024-11-27** for two of three,
97/8 downloads-month, no published eval tables beyond the UzLiB entry, and they were the *baselines*
`alloma` was measured against — so those UzLiB numbers are third-party, not self-reported. Mistral-7B
is 7B and licence-gated. Low priority.

#### Others seen, dismissed

- `bxod/Llama-3.2-{1B,3B}-Instruct-uz` (same `uzlm` author) — 0.2456 / 0.2832, i.e. **at or below
  chance**. Not useful.
- `iyuldashev/LLM-for-Uzbek` — Llama 3.1 8B fine-tune, GitHub-only, no model card, no evals, not on
  UzLiB.
- `ai-forever/mGPT-1.3B-uzbek` — MIT, 1.3B, genuine Uzbek CPT (50k steps, val ppl 6.84), 2048 ctx.
  Credible provenance (Sber's ai-forever, 23 parallel language models) but it is a **2023-era GPT-2/
  GPT-3-style base model, not instruction-tuned**, 2048 context, and scores below chance on UzLiB
  era models. Not viable for a JSON-schema task.
- `IslombekT/uzbek-gpt-103m` — 103M from scratch, Apache-2.0, explicitly "not an instruction/chat
  model." Educational project.
- BERT-family encoders (BERTbek, UzBERT) — encoders only, not generative. Irrelevant.
- Kazakh/Central-Asia ecosystem (ISSAI KAZ-LLM `cc-by-nc` — **non-commercial, unusable**; TilQazyna;
  QOSI; Sherkala; stukenov/sozkz; Cybernet AI ASR) — all Kazakh-focused. No Uzbek LLM of note.
  "Turdimov" and "Mega" as Central-Asia LLMs: **[NOT FOUND]**.

---

## 3. Structured JSON output reliability

This is the axis where open models actually win, and it is the one that matters most for Suhbatdosh
because you already pass `CallAnalysis` as a `response_schema`.

### llama.cpp — LLGuidance (recommended)

[`docs/llguidance.md`](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/docs/llguidance.md):
llama.cpp integrates **LLGuidance**, a constrained-decoding engine taking **JSON Schema** directly.
`-j` on `llama-cli` / the `json_schema` field on `llama-server` routes to it.

> "Computing a 'token mask'… for a llama3 tokenizer with 128k tokens takes, on average, **50 μs of
> single-core CPU time**… p99 0.5 ms, p100 20 ms."

> "Unsupported schemas result in an error message — **no keywords are silently ignored**."

This is the behaviour you want: **the decode physically cannot emit a token that violates the
schema.** JSON validity and Pydantic parseability stop being a probabilistic question entirely.
Schema *semantics* (is `overall` sensible? is `coaching_points` actually in Uzbek?) remain the
model's problem — but structural failure goes to zero.

Two caveats:
- Build with `-DLLAMA_LLGUIDANCE=ON`, **which requires a Rust toolchain.** Non-obvious deployment
  wrinkle; budget for it or use the prebuilt Docker image.
- Legacy GBNF grammars are still supported but are inferior: LLGuidance has a proper lexer and
  handles JSON Schema far more completely.

### Ollama — `format`

[Ollama structured outputs](https://ollama.com/blog/structured-outputs) (Dec 2024) — pass a JSON
Schema (or Pydantic's `model_json_schema()`) as `format`. Also exposes OpenAI-compatible
`client.beta.chat.completions.parse(response_format=Model)`, which means you could point
`analysis.py` at a local OpenAI-compatible endpoint with minimal changes. Their own tips: define the
schema in Pydantic, add "return as JSON" to the prompt, set temperature 0.

### vLLM / SGLang

Both support guided JSON decoding and tool-call parsers. The Qwen3.5-4B card documents
`--enable-auto-tool-choice --tool-call-parser qwen3_coder`. Note vLLM requires `main`/nightly for
Qwen3.5, and vLLM on **CPU** is not a good fit — use llama.cpp for CPU.

### Evidence the model itself is good at structured output

The Qwen3.5-4B model card carries community eval results from `llamaindex/ExtractBench` via a
pipeline literally named `qwen3_5_4b_vllm_extract_oneshot_structured_output_file`:
mean **82.43**, short 89.06, medium 76.64. That's a direct, third-party measurement of
**4B-parameter schema-constrained extraction quality**, and it's respectable. It also reports
MMLU-Pro 79.1 and GPQA Diamond 76.2.

IFEval 89.8 (vs GPT-OSS-120B's 88.9) — instruction-following is a Qwen strength, which matters for
"emit exactly these 8 scorecard keys."

### Per-model reliability summary

| Model | Native JSON mode | Constrained decode | Verdict |
|---|---|---|---|
| **Qwen3.5-4B / 9B** | tool calling, `--tool-call-parser qwen3_coder` | vLLM guided / SGLang / Ollama / LLGuidance | **Best.** Documented structured-output eval. |
| Qwen3-8B / 4B | tool calling | same | Good; older tool template, superseded. |
| `uzlm/alloma-*` | none documented | works (architecture is plain Llama) | Structurally fine, but 2048–4096 ctx and the APST hack. |
| `behbudiy/*` | none documented | works (plain Mistral/Llama) | Structurally fine, quality unproven. |
| `NeuronAI-Uzbek` | none documented | — | **`trust_remote_code=True`. Reject.** |

**Note:** because you can force the schema at the decoding layer, the "models that ramble" problem
largely evaporates. Pick on Uzbek *content* quality, not on JSON reliability.

---

## 4. Practical deployment

### Quantization / memory

Standard GGUF ladder (llama.cpp `tools/quantize` README, per-8B-model): Q8_0 ~8.5 GB (~99%),
Q6_K ~6.6 GB, Q5_K_M ~5.7 GB, **Q4_K_M ~4.9 GB (~95–97%, the default)**, Q3_K_M ~4.0 GB, Q2_K ~3.2 GB.

Ollama's published Qwen3.5 sizes (Q4 default): `qwen3.5:0.8b` 1.0 GB, `:2b` 2.7 GB, **`:4b` 3.4 GB**,
`:9b` 6.6 GB, `:27b` 17 GB. MLX variants also exist.

Rule of thumb for your server: **RAM ≈ 1.5 × GGUF file size + ~1 GB**, and give yourself headroom —
Qwen3.5's 248k vocab makes the embedding matrix a meaningful fixed cost.

Recommendation: **Q5_K_M or Q6_K.** Community guidance is explicit that small models (~4B) should sit
at Q5_K_M/Q6_K rather than Q4_K_M, and Qwen3.5-4B's Q4_K_M is only 2.5 GiB so you have no size
pressure. Don't go below Q4.

You can convert any of these yourself in two steps:
```
python convert_hf_to_gguf.py Qwen/Qwen3.5-4B --outfile Qwen3.5-4B-F16.gguf
./build/bin/llama-quantize Qwen3.5-4B-F16.gguf Qwen3.5-4B-Q5_K_M.gguf Q5_K_M
```
Or just `ollama pull qwen3.5:4b` and be done.

### CPU throughput — measured numbers

| Model | Quant | Hardware | gen tok/s | prompt tok/s |
|---|---|---|---|---|
| Qwen3.5-4B | Q4_K_M | RX 580, Vulkan, 256 GB/s | 38 | 340 |
| Qwen3.5-4B | Q8_0 | same | 38 | — |
| Qwen3.5-9B | Q4_K_M | same | 24 | 204 |
| Llama-3.2-3B | Q4_K_M | same | 62 | 475 |
| Qwen3.5-4B | Q4_0 | Radxa ITX, 4× Cortex-A76 (weak ARM) | **6.9** | 30.7 |
| Qwen3.5-9B | Q4_0 | same | 3.96 | 17.6 |
| Qwen3.5-27B | Q4_0 | same | 1.29 | 5.05 |
| gpt-oss-20B | Q8_0 | Ryzen AI 9 HX 370 (laptop) | ~10.4 | — |

The RX 580 numbers are from [FireCulex/llm-rx580 BENCHMARKS.md](https://github.com/FireCulex/llm-rx580/blob/main/BENCHMARKS.md)
and the Radxa numbers from [invisiofficial/rk-llama.cpp#9](https://github.com/invisiofficial/rk-llama.cpp/issues/9);
the laptop figure is Phoronix/OpenBenchmarking. Directional, not lab-matched.

**What this means for you.** Generation is memory-bandwidth-bound, so throughput scales with RAM
bandwidth, not FLOPs. On a modest modern x86 server (a Xeon E-23xx / Ryzen 7 class, DDR4-3200
dual-channel ≈ 50 GB/s) expect roughly **20–40 tok/s for Qwen3.5-4B at Q5_K_M/Q4_K_M**, and about
half that for 9B. On a thin client or a Raspberry-class box, budget for single digits.

**Workload arithmetic for Suhbatdosh.** Input 500–2000 tokens (prompt processing is fast — 200–500
tok/s, so prefill is 2–10 s), output ~300 tokens (8–15 s at 20–40 tok/s). **Total ≈ 15–30 s per
call.** That's comfortably inside your existing 60 s `_analyze_call` timeout, and the async
poll-then-analyze design in `api.py:98` absorbs it without changes.

Throughput note: generation is batch-1 here. If you ever need concurrency, vLLM on a modest GPU
beats llama.cpp on CPU by a lot — but at your volume (training-centre call counts, tens/day) that
optimisation is not worth the complexity.

### Runtime support matrix

| | llama.cpp | Ollama | vLLM | llama-cpp-python |
|---|---|---|---|---|
| Qwen3.5 (hybrid Gated DeltaNet + attention) | ✅ (`Qwen3_5ForConditionalGeneration`; llama.cpp ≥ the b5401-era line) | ✅ official tags | ✅ **main/nightly only** | ⚠️ depends on build |
| Custom-vocab Llama fine-tunes (alloma) | ✅ | ✅ via `hf.co/…` | ✅ | ✅ |
| **JSON-Schema constrained decode** | ✅ LLGuidance (`-j`) | ✅ `format` | ✅ guided decoding | ⚠️ via `grammar`/schema |
| **CPU** | ✅ best | ✅ good | ❌ poor fit | ✅ |

All Qwen3.5 models are available as GGUF (community quants — bartowski, unsloth) — HF's
"Quantizations: 509 models" on Qwen3.5-4B confirms broad quantiser coverage. `unsloth/*-GGUF` repos
are ungated, unlike `meta-llama/*` — useful, since the alloma/behbudiy bases are licence-gated.

---

## 5. Tokenizer quality for Uzbek — the concrete trap

**Uzbek's Latin alphabet uses three non-ASCII characters that break tokenizers:**
`oʻ` (U+02BB MODIFIER LETTER TURNED COMMA), `gʻ` (U+02BB), and `ʼ` (U+02BC MODIFIER LETTER APOSTROPHE),
in words like `oʻzbek`, `toʻgʻri`, `maʼlum`. They are **not** interchangeable with ASCII `'` and
**not** with the right single quotation mark `’`. Training corpora are inconsistent about which one
they use, so even the "correct" codepoint varies by source.

Documented evidence:

1. **`uzlm/alloma` made this their entire reason for existing.** Their card's headline claim is
   1.7 vs ~3.5 tokens per Uzbek word, achieved by vocabulary surgery. Their usage code requires
   regex-replacing `[’‘‚‛ʻʼʽʾʿˈˊˋˌˍ'\']` → `"APST"` before tokenising. **That the leading
   Uzbek-specific model needed a mandatory 11-codepoint pre-processing hack is the clearest
   possible evidence that this is a real problem.** (Amusing side-effect visible in their own
   benchmark table: the news-classification label `TaAPSTlim` = `Ta'lim`.)

2. **Quantified fertility** — from `NeuronUz/NeuronAI-Uzbek`'s table (methodology is sound even if
   their weights are suspect):

   | Tokenizer | Uzbek tokens/word | Vocab |
   |---|---|---|
   | Gemma 2 9B | 3.15 | 256,000 |
   | Llama 3.1 8B | 3.32 | 128,256 |
   | DeepSeek-V3 | 3.32 | 128,815 |
   | Qwen3-4B | 3.44 | 151,669 |
   | *(claimed)* NeuronAI-Uzbek | 2.67 | 180,000 |

   Qwen3's 151k vocab at 3.44 tokens/word is *worse than Llama's 128k at 3.32* on Uzbek, despite
   being a newer, larger-vocab multilingual tokenizer. **Bigger vocab ≠ better Uzbek.** The Qwen
   advantage on Uzbek is semantic coverage, not token efficiency.

3. **Qwen3.5's counter-trend.** Its vocab jumped 152k → 248k with an explicit claim of "10–60%"
   encoding-efficiency gains "across most languages," alongside 201-language coverage. This is the
   strongest tokenizer story for Uzbek of any general model — but it is a *vendor claim*, and the
   specific Uzbek figure is **[UNVERIFIED]**.

4. **Qwen's tokenizer is not extensible.** From [QwenLM/Qwen `tokenization_note.md`](https://github.com/QwenLM/Qwen/blob/main/tokenization_note.md):
   > "The tokenizer of Qwen models are based on BPE and **you cannot directly expand the vocabulary
   > by adding words to the vocabulary**. The intermediate merges are needed for tokenization."

   So the "just add my domain vocabulary" trick that alloma did **does not work** on Qwen. If you
   want a domain-adapted tokenizer, you must rebuild the BPE merges, or fine-tune on top of a
   custom-vocab model.

### What this means for the STT→LLM seam specifically

**Likely a non-issue in your pipeline, but verify.** GigaAM int8 via sherpa-onnx outputs ASCII
apostrophes for Uzbek (`o'zbek`, `to'g'ri`). ASCII `'` is well-represented in Qwen's vocab
(token id 6 per the Qwen3.5 tokenizer dump). So the input side is probably fine. The **output** side
is the risk: does the model emit `oʻzbek` or `o'zbek` or `o‘zbek`? All three are defensible orthography
for your users, so don't over-engineer — but do **normalise apostrophes in a post-processing step**
before storing `coaching_points` / `summary`, and make sure your scoring SQL that matches on
`'hal qilindi'` (see `db.py:905-915`) is robust to whatever codepoint comes out. **This is worth
auditing regardless of which model you pick.**

---

## 6. Ranked shortlist

| # | Model | Size | Licence | Uzbek evidence | JSON | CPU fit |
|---|---|---|---|---|---|---|
| **1** | `Qwen/Qwen3.5-4B` | 4B (+1B vision) | Apache-2.0 | Qwen3 names Northern Uzbek; Qwen3.5 claims 201 langs **[UNVERIFIED]**; 248k vocab | tool calling + guided/constrained | ✅ 3.4 GB Q4 / ~4 GB Q5_K_M |
| **2** | `Qwen/Qwen3.5-9B` | 9B | Apache-2.0 | same | same | ✅ 6.6 GB Q4, ~2× latency |
| **3** | `Qwen/Qwen3.5-2B` | 2B | Apache-2.0 | same | same | ✅ 2.7 GB — only if RAM is tight |
| **4** | `Qwen/Qwen3.5-0.8B` | 0.8B | Apache-2.0 | same | same | ✅ 1.0 GB — likely too weak to judge sales calls |
| **5** | `Qwen/Qwen3-8B` | 8B | Apache-2.0 | UzLiB 0.385 (near chance); TUMLU-era Qwen2.5-7B = 34.6 | tool calling | ✅ 4.9 GB Q4_K_M |
| 6 | `uzlm/alloma-8B-Instruct` | 8B | **llama3.1** | best self-reported Uzbek fluency; 1.7 tok/word | none native | ⚠️ **4096 ctx** blocker |
| 7 | `behbudiy/Mistral-7B-Instruct-Uz` | 7B | Mistral + custom | UzLiB 0.4202, third-party | none native | ⚠️ stale (2024-11) |
| 8 | `gemma-3-4b-it` | 4B | Gemma ToU | **no Uzbek claim**; no `uz` in benchmarked langs | structured outputs + function calling (Google states it) | ✅ 3.3 GB |
| — | `NeuronUz/NeuronAI-Uzbek` | 4B | Apache-2.0 | contaminated eval | — | ❌ **`trust_remote_code=True`** |
| — | `behbudiy/Mistral-Nemo-Instruct-Uz` | 12B | Mistral | 0.3799 | — | ❌ too big |
| — | `bxod/Llama-3.2-{1B,3B}-uz` | 1–3B | llama3.2 | **below chance** | — | ❌ |
| — | `ai-forever/mGPT-1.3B-uzbek` | 1.3B | MIT | ppl 6.84 | — | ❌ not instruction-tuned |
| — | ISSAI KAZ-LLM | 8B/70B | **CC-BY-NC** | Kazakh | — | ❌ non-commercial |

---

## 7. Recommendation and reasoning

### Deploy `Qwen/Qwen3.5-4B`, Q5_K_M GGUF, llama.cpp, constrained JSON, non-thinking mode.

**Why this model:**

1. **It is the only family that names Uzbek.** Every other candidate is an inference from "it's
   multilingual" — and Qwen's own TUMLU-family results show those inferences are optimistic.
2. **Licence is clean.** Apache-2.0, no gating, no acceptable-use clauses. For a corporate
   on-prem customer this matters as much as quality. All the Uzbek fine-tunes are either
   llama3.x-licensed or need `trust_remote_code`.
3. **Structured output is solved, not hoped-for.** LLGuidance makes schema violations structurally
   impossible; on top of that, 4B Qwen3.5 scores 82.4 on ExtractBench under a structured-output
   pipeline. This is the constraint you called out as decisive, and it's fully met.
4. **It fits.** ~4 GB at Q5_K_M, 15–30 s per call, under your existing 60 s timeout. The 9B is the
   natural fallback if quality is short and RAM allows.
5. **Context is a non-issue.** 262k native. Contrast with alloma-3B at 2048, which cannot fit your
   upper-end transcripts at all.

**Why 4B and not 9B as the default:** the task is *not* knowledge-heavy. It's instruction-following
on ~1500 tokens with a fixed schema — where 4B scores IFEval 89.8, above GPT-OSS-120B. TUMLU shows
knowledge is where scale is needed, and you don't need much knowledge. Start at 4B; move to 9B only
if your own eval says so.

**Why the honest headline: you will need to fine-tune.** TUMLU's Qwen2.5-7B Uzbek score of 34.6 and
§5.3's "models understand but generate in the wrong language" both point the same way. An un-finetuned
4B will produce *structurally perfect but substantively mediocre* coaching. Expect to spend the
project's real effort on:

- Building a few hundred labelled Suhbatdosh transcripts (you already have Gemini outputs — **those
  are your SFT targets**, distillation rather than labelling from scratch).
- A held-out eval set scored by your own rubrics, plus schema-validity rate measured end-to-end.
- Possibly normalising apostrophes in output, and auditing the `'hal qilindi'` string-match in
  `db.py:905-915` against real model output.

**Suggested immediate next step:** a 20-prompt Uzbek bake-off of `Qwen3.5-4B`, `Qwen3.5-9B`,
`Qwen3-8B` and `uzlm/alloma-8B-Instruct` behind LLGuidance, measuring schema-validity rate and
whether `summary`/`coaching_points` come out in Uzbek. That closes the one gap this research left
open — the Qwen3.5 201-language list.

---

## Sources

- [Qwen3 release post](https://qwen.ai/blog?id=qwen3) · [Qwen3 tech report](https://arxiv.org/html/2505.09388v1) · [Qwen3.5 release post](https://qwen.ai/blog?id=qwen3.5) · [Qwen3.5-4B model card](https://huggingface.co/Qwen/Qwen3.5-4B) · [Qwen tokenization note](https://github.com/QwenLM/Qwen/blob/main/tokenization_note.md)
- [TUMLU (Findings of ACL 2025)](https://arxiv.org/html/2502.11020v1) · [code](https://github.com/ceferisbarov/TUMLU)
- [UzLiB](https://github.com/tahrirchi/uzlib) · [leaderboard](https://github.com/tahrirchi/uzlib/blob/main/LEADERBOARD.md)
- [uzlm/alloma-8B-Instruct](https://huggingface.co/uzlm/alloma-8B-Instruct) · [alloma-3B](https://huggingface.co/uzlm/alloma-3B-Instruct) · [uzlm org](https://huggingface.co/uzlm)
- [NeuronUz/NeuronAI-Uzbek](https://huggingface.co/NeuronUz/NeuronAI-Uzbek) · [behbudiy org](https://huggingface.co/behbudiy) · [bxod/Llama-3.2-3B-Instruct-uz (leaderboard-linked)](https://huggingface.co/bxod/Llama-3.2-3B-Instruct-uz)
- [ai-forever/mGPT-1.3B-uzbek](https://huggingface.co/ai-forever/mGPT-1.3B-uzbek) · [IslombekT/uzbek-gpt-103m](https://github.com/TurdiyevIslombek/uzbek-gpt-from-scratch)
- [Gemma 3 blog](https://huggingface.co/blog/gemma3) · [gemma-3-27b-it](https://huggingface.co/google/gemma-3-27b-it) · [TranslateGemma lang-code discussion](https://huggingface.co/google/translategemma-27b-it/discussions/1)
- [llama.cpp LLGuidance docs](https://github.com/ggml-org/llama.cpp/blob/master/docs/llguidance.md) · [llama.cpp docs dir](https://github.com/ggml-org/llama.cpp/tree/master/docs) · [quantize README](https://github.com/L-Ark/llama.cpp/blob/master/tools/quantize/README.md)
- [Ollama structured outputs](https://ollama.com/blog/structured-outputs) · [Ollama Qwen3.5 library](https://ollama.com/library/qwen3.5)
- [llama.cpp throughput — RX 580](https://github.com/FireCulex/llm-rx580/blob/main/BENCHMARKS.md) · [Radxa ITX](https://github.com/invisiofficial/rk-llama.cpp/issues/9) · [Phoronix/OpenBenchmarking](https://mail.openbenchmarking.org/test/pts/llama-cpp)
- [GGUF quantization primer](https://d-central.tech/quantization-explained-gguf-q4-q8-fp16)
- [ISSAI KAZ-LLM (CC-BY-NC)](https://issai.nu.edu.kz/kazllm) · [BERTbek (SIGUL 2024)](https://aclanthology.org/2024.sigul-1.5)