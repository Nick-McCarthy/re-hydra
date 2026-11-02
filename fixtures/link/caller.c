__attribute__((noinline))
int caller(int x) {
  return leaf(x) + 1;
}
