import User from "../models/User.js";

export const getUsers = async (req, res) => {
  const users = await User.find();
  res.json(users);
};

export const createUser = async (req, res) => {
  const { name, email } = req.body;
  const user = await User.create({ name, email });

  res.status(201).json({ message: "User created successfully", data: user });
};
