import type { ImageSourcePropType } from "react-native";

/**
 * Deeply 三个语境的头像。集中导出避免散落 require()。
 *
 * - main:  Deeply 品牌主头像。给「+ 新建会话」选择页 / 启动器卡片用。
 * - chatBuddy: 知识探索助手语态,聊天列表那一行 + 探索 chat 里的 agent 头像。
 * - learning: 课程讲解语态,课程讲解 surface 里的 agent 头像。
 */
export const deeplyAvatarMain = require("./assets/deeply-avatar-main.jpg") as ImageSourcePropType;
export const deeplyAvatarChatBuddy = require("./assets/deeply-avatar-chat-buddy.png") as ImageSourcePropType;
export const deeplyAvatarLearning = require("./assets/deeply-avatar-learning.jpg") as ImageSourcePropType;
