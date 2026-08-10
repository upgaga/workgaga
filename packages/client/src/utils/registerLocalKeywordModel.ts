import { registerLocalKeywordModelAdapter } from "./localKeywordModel";
import { onnxLocalKeywordModel } from "./onnxLocalKeywordModel";

let registered = false;

export const registerLocalKeywordModel = (): void => {
  if (registered) return;
  registered = true;
  registerLocalKeywordModelAdapter(onnxLocalKeywordModel);
};
