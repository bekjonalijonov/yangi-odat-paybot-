import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  user_id: { type: Number, unique: true },
  username: String,

  status: { type: String, default: "inactive" },   // active | grace | inactive
  payment_method: String,

  joined_at: String,
  expires_at: String,

  retry_count: { type: Number, default: 0 },
  bonus_days: { type: Number, default: 0 },
  remind_on: { type: Boolean, default: true },

  history: { type: Array, default: [] }
});

export default mongoose.model("User", userSchema);
