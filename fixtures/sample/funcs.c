__attribute__((noinline))
int skip_space(const char *p) {
  return *p == ' ';
}

__attribute__((noinline))
int header_size(const struct Header *h) {
  if (h->length < 0) {
    return 0;
  }
  return h->length;
}

__attribute__((noinline))
int parse_header(const struct Header *h, const char *p) {
  if (skip_space(p)) {
    return header_size(h);
  }
  return 0;
}
