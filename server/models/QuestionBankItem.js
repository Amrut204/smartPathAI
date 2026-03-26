import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const questionBankItemSchema = new Schema(
  {
    questionText: { type: String, required: true, index: true, trim: true },
    options: {
      type: [String],
      required: true,
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length === 4;
        },
        message: "Must have exactly 4 options",
      },
    },
    correctAnswer: {
      type: String,
      required: true,
      enum: ["A", "B", "C", "D"],
    },
    explanation: { type: String, required: true, trim: true },
    topic: { type: String, required: true, index: true, trim: true },
    subject: { type: String, required: true, index: true, trim: true },
    category: { type: String, required: true, trim: true },
    difficulty: {
      type: String,
      required: true,
      enum: ["easy", "medium", "hard"],
      index: true,
    },
    subtopic: { type: String, default: null, trim: true },
    tags: { type: [String], default: [] },
    llmSource: {
      type: String,
      required: true,
      enum: ["claude", "gpt4", "gemini", "llama", "mistral"],
    },
    providerModel: { type: String, default: null },
    generatedAt: { type: Date, default: Date.now },
    generationCost: { type: Number, default: 0 },
    estimatedTime: { type: Number, default: 60 },
    usageCount: { type: Number, default: 0 },
    qualityScore: { type: Number, default: 0, min: 0, max: 100 },
    status: {
      type: String,
      enum: ["draft", "reviewed", "approved", "rejected"],
      default: "draft",
    },
    validated: { type: Boolean, default: false },
    validationErrors: { type: [String], default: [] },
    isDuplicate: { type: Boolean, default: false },
    duplicateOf: { type: Schema.Types.ObjectId, ref: "QuestionBankItem", default: null },
  },
  {
    collection: "question_bank_items",
    timestamps: true,
  },
);

questionBankItemSchema.index({ topic: 1, difficulty: 1 });
questionBankItemSchema.index({ subject: 1, category: 1 });
questionBankItemSchema.index({ llmSource: 1, status: 1 });

export const QuestionBankItem = models.QuestionBankItem ?? model("QuestionBankItem", questionBankItemSchema);
export { questionBankItemSchema };
