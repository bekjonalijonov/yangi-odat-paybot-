import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema({
  user_id: Number,
  date: String,
  amount: Number,
  method: String,
  status: String
});

export default mongoose.model("Payment", paymentSchema);
