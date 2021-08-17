// This file defines a list of GUI element types that the WhatsApp Web page uses.
// The list can change in major WhatsApp Web updates. TODO: identify these dynamically based on React elements

var UIClassNames = {};

(function() {

UIClassNames.MENU_ITEM_CLASS = "_2cNrC";
UIClassNames.MENU_ITEM_HIGHLIGHTED_CLASS = "_1CTfw";

UIClassNames.OUTER_DROPDOWN_CLASS = "o--vV"; // outside class of dropdown with "mark as unread"
UIClassNames.DROPDOWN_CLASS = "_1HnQz";
UIClassNames.DROPDOWN_ENTRY_CLASS = "_2qR8G _1wMaz _18oo2";

UIClassNames.CHEKBOX_PADDIG_CLASS = "_3yThi";
UIClassNames.RECTANGLE_CLASS = "_2MZaO";
UIClassNames.GREEN_BACKGROUND_CLASS = "UF5Li";
UIClassNames.CHECKBOX_CHECKED_CLASS = UIClassNames.RECTANGLE_CLASS + " " + UIClassNames.CHEKBOX_PADDIG_CLASS + " " + UIClassNames.GREEN_BACKGROUND_CLASS;
UIClassNames.CHECKBOX_UNCHECKED_CLASS = UIClassNames.RECTANGLE_CLASS + " " + UIClassNames.CHEKBOX_PADDIG_CLASS + " " + "_2MZaO";
UIClassNames.TICKED_CLASS = "_2IweK _2PGX8";
UIClassNames.UNTICKED_CLASS = "_2IweK _1NdIy";

UIClassNames.UNREAD_COUNTER_CLASS = "_23LrM";

UIClassNames.CHAT_PANEL_CLASS = "_1LcQK"; // the outermost chat panel class
UIClassNames.INNER_CHAT_PANEL_CLASS = "_33LGR"; // the innermost chat panel class

UIClassNames.CHAT_ENTRY_CLASS = "_3m_Xw"; // the chat entry in the chats list
UIClassNames.UNREAD_MARKER_CLASS = "_3cOAM"; // the class inside the top-level item;

UIClassNames.CHAT_MESSAGE = "_2wUmf";
UIClassNames.CHAT_MESSAGE_FROM_SELF_CLASS = "_21bY5";
UIClassNames.TEXT_WRAP_POSITION_CLASS = "_1Gy50";
UIClassNames.DELETED_MESSAGE_DIV_CLASS = "_3TjU1";
UIClassNames.DELETED_MESSAGE_SPAN = "_20bHr";
UIClassNames.IMAGE_MESSAGE_IMG = "_1WrWf";
UIClassNames.STICKER_MESSAGE_TAG = "_3mPXD";
})();
