import jwt from "jsonwebtoken";

const generateToken = (id) => {
  return jwt.sign({ id }, "562ed3ae5adbfa3de23c60421e3cd70d3770c180eb63d644fc4133ad9e3c8ab6", { expiresIn: "7d" });
};

export default generateToken;
