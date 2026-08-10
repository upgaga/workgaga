# bert-mini-finetuned-ner-chinese-onnx

- 来源：https://huggingface.co/TomatoMTL/bert-mini-finetuned-ner-chinese-onnx
- 许可证：Apache-2.0
- 用途：BERT Mini 中文命名实体识别（NER），不是专门的关键词模型；应用将 PER、ORG、LOC、MISC 实体作为关键词候选。
- 标签：`O/B-PER/I-PER/B-ORG/I-ORG/B-LOC/I-LOC/B-MISC/I-MISC`

## 文件清单与 SHA256

| 文件 | SHA256 |
| --- | --- |
| `onnx/model_quantized.onnx` | `80db3cf7b9edc7d1ba4cc20561a46efda957b1f07a27ac911d31304be8baf5f3` |
| `config.json` | `59531bea0d7a9e9b8d0d2c133990cb6fbb66dfd561b2acb1f8a98944cc659cf8` |
| `tokenizer.json` | `90b7637c70d79b2e2d4e6bb7257445c23e3b7558ab6e7ceb5a9b2e0e859b2f9a` |
| `tokenizer_config.json` | `3a5b2440d95085545706321f1de315cfbaeeddd204f389a87918e250af92acdc` |
| `special_tokens_map.json` | `3c3507f36dff57bce437223db3b3081d1e2b52ec3e56ee55438193ecb2c94dd6` |
| `vocab.txt` | `f7863b040bae29ac474065729355252248c92d41141c1e09fbf21dd3e593a238` |
| `quantize_config.json` | `f9cabf180dc0369465242855ac972cfc0e80d49ac22a9b7175d9ccc3a3db2e98` |

模型运行时从静态 `/models/keyword/bert-mini-finetuned-ner-chinese-onnx/` 路径加载，不复制到 `dist`。
