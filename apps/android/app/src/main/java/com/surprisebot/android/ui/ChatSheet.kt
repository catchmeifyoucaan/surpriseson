package com.surprisebot.android.ui

import androidx.compose.runtime.Composable
import com.surprisebot.android.MainViewModel
import com.surprisebot.android.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}
